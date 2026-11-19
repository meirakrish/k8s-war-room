import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { SCHEMA } from "./schema.ts";
import type { BoardEvent, ClaimResult, Json, Post, PostKind, Task, TaskStatus } from "./types.ts";
import { POST_KINDS } from "./types.ts";

/** A caller mistake (unknown task, wrong owner, bad state), as opposed to a bug or a database failure. */
export class BoardError extends Error {
  readonly code: "not_found" | "not_owner" | "bad_state" | "invalid";
  constructor(code: BoardError["code"], message: string) {
    super(message);
    this.name = "BoardError";
    this.code = code;
  }
}

type Row = Record<string, unknown>;

const toTask = (r: Row): Task => ({
  id: r.id as number,
  type: r.type as string,
  status: r.status as TaskStatus,
  claimedBy: (r.claimed_by as string | null) ?? null,
  parentId: (r.parent_id as number | null) ?? null,
  input: JSON.parse(r.input as string) as Json,
  result: JSON.parse(r.result as string) as Json,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toPost = (r: Row): Post => ({
  id: r.id as number,
  taskId: r.task_id as number,
  agent: r.agent as string,
  kind: r.kind as PostKind,
  content: r.content as string,
  evidence: JSON.parse(r.evidence as string) as Json,
  createdAt: r.created_at as string,
});

const toEvent = (r: Row): BoardEvent => ({
  id: r.id as number,
  ts: r.ts as string,
  actor: r.actor as string,
  type: r.type as BoardEvent["type"],
  taskId: (r.task_id as number | null) ?? null,
  payload: JSON.parse(r.payload as string) as Json,
});

/**
 * The shared board. This is the only place that touches SQLite; everything else (the MCP server, tests, a future UI)
 * goes through these methods.
 *
 * Concurrency model: every mutation runs in a `BEGIN IMMEDIATE` transaction, which takes SQLite's write lock up
 * front. Writers therefore queue behind each other (waiting up to `busy_timeout`) instead of failing midway, and the
 * state change plus its event row commit together or not at all. Several processes can open the same file; WAL mode
 * lets them read while one writes.
 */
export class Board {
  readonly #db: DatabaseSync;

  constructor(path = ":memory:") {
    this.#db = new DatabaseSync(path);
    this.#db.exec("PRAGMA journal_mode = WAL");
    this.#db.exec("PRAGMA busy_timeout = 5000");
    this.#db.exec("PRAGMA foreign_keys = ON");
    this.#db.exec(SCHEMA);
  }

  close(): void {
    this.#db.close();
  }

  // --- writes ---------------------------------------------------------------------------------------------------

  createTask(args: { type: string; actor: string; input?: Json; parentId?: number | null }): Task {
    return this.#tx(() => {
      const parentId = args.parentId ?? null;
      if (parentId !== null && !this.#get(parentId))
        throw new BoardError("not_found", `parent task ${parentId} does not exist`);
      const now = new Date().toISOString();
      const { lastInsertRowid } = this.#run(
        "INSERT INTO tasks (type, parent_id, input, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        args.type,
        parentId,
        JSON.stringify(args.input ?? null),
        now,
        now,
      );
      const task = this.#mustGet(Number(lastInsertRowid));
      this.#event(args.actor, "task_created", task.id, { type: task.type, parentId });
      return task;
    });
  }

  /**
   * Atomically claim an open task. Losing a race is a normal outcome, not an error, so it is a return value.
   *
   * The atomicity comes from one conditional UPDATE: `WHERE id = ? AND status = 'open'`. Two agents may both have seen
   * the task as open, but the database applies their updates one at a time; the second finds status = 'claimed', matches
   * zero rows, and loses. There is no read-then-write gap for an agent to fall into.
   */
  claimTask(id: number, agent: string): ClaimResult {
    return this.#tx(() => {
      const now = new Date().toISOString();
      const { changes } = this.#run(
        "UPDATE tasks SET status = 'claimed', claimed_by = ?, updated_at = ? WHERE id = ? AND status = 'open'",
        agent,
        now,
        id,
      );
      if (changes === 0) {
        const t = this.#get(id);
        if (!t) return { claimed: false, reason: `task ${id} does not exist` };
        return {
          claimed: false,
          reason: `task ${id} is already ${t.status}${t.claimedBy ? ` by ${t.claimedBy}` : ""}`,
        };
      }
      this.#event(agent, "task_claimed", id, null);
      return { claimed: true, task: this.#mustGet(id) };
    });
  }

  /** Posts are open to everyone: a Reviewer comments on the Remediator's task, an investigator on its own. */
  post(args: { taskId: number; agent: string; kind: PostKind; content: string; evidence?: Json }): Post {
    if (!POST_KINDS.includes(args.kind)) throw new BoardError("invalid", `unknown post kind '${args.kind}'`);
    return this.#tx(() => {
      if (!this.#get(args.taskId)) throw new BoardError("not_found", `task ${args.taskId} does not exist`);
      const { lastInsertRowid } = this.#run(
        "INSERT INTO posts (task_id, agent, kind, content, evidence, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        args.taskId,
        args.agent,
        args.kind,
        args.content,
        JSON.stringify(args.evidence ?? null),
        new Date().toISOString(),
      );
      const post = toPost(this.#row("SELECT * FROM posts WHERE id = ?", Number(lastInsertRowid))!);
      this.#event(args.agent, "post_added", args.taskId, { postId: post.id, kind: post.kind });
      return post;
    });
  }

  /** Only the agent holding the claim may finish a task. */
  completeTask(args: { id: number; agent: string; status: "done" | "failed"; result?: Json }): Task {
    return this.#tx(() => {
      const t = this.#get(args.id);
      if (!t) throw new BoardError("not_found", `task ${args.id} does not exist`);
      if (t.status !== "claimed") throw new BoardError("bad_state", `task ${args.id} is ${t.status}, not claimed`);
      if (t.claimedBy !== args.agent)
        throw new BoardError("not_owner", `task ${args.id} is claimed by ${t.claimedBy}, not ${args.agent}`);
      this.#run(
        "UPDATE tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?",
        args.status,
        JSON.stringify(args.result ?? null),
        new Date().toISOString(),
        args.id,
      );
      this.#event(args.agent, "task_completed", args.id, { status: args.status });
      return this.#mustGet(args.id);
    });
  }

  // --- reads ----------------------------------------------------------------------------------------------------

  listOpenTasks(filter: { type?: string } = {}): Task[] {
    const rows = filter.type
      ? this.#rows("SELECT * FROM tasks WHERE status = 'open' AND type = ? ORDER BY id", filter.type)
      : this.#rows("SELECT * FROM tasks WHERE status = 'open' ORDER BY id");
    return rows.map(toTask);
  }

  getTask(id: number): Task | null {
    return this.#get(id);
  }

  listTasks(): Task[] {
    return this.#rows("SELECT * FROM tasks ORDER BY id").map(toTask);
  }

  listPosts(taskId?: number): Post[] {
    const rows =
      taskId === undefined
        ? this.#rows("SELECT * FROM posts ORDER BY id")
        : this.#rows("SELECT * FROM posts WHERE task_id = ? ORDER BY id", taskId);
    return rows.map(toPost);
  }

  /** Events with id > afterId, oldest first. A UI tails the board by remembering the last id it saw. */
  listEvents(afterId = 0): BoardEvent[] {
    return this.#rows("SELECT * FROM events WHERE id > ? ORDER BY id", afterId).map(toEvent);
  }

  // --- internals ------------------------------------------------------------------------------------------------

  #tx<T>(fn: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.#db.exec("COMMIT");
      return result;
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  #event(actor: string, type: BoardEvent["type"], taskId: number | null, payload: Json): void {
    this.#run(
      "INSERT INTO events (ts, actor, type, task_id, payload) VALUES (?, ?, ?, ?, ?)",
      new Date().toISOString(),
      actor,
      type,
      taskId,
      JSON.stringify(payload),
    );
  }

  #run(sql: string, ...params: SQLInputValue[]) {
    return this.#db.prepare(sql).run(...params);
  }
  #row(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.#db.prepare(sql).get(...params) as Row | undefined;
  }
  #rows(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.#db.prepare(sql).all(...params) as Row[];
  }
  #get(id: number): Task | null {
    const r = this.#row("SELECT * FROM tasks WHERE id = ?", id);
    return r ? toTask(r) : null;
  }
  #mustGet(id: number): Task {
    const t = this.#get(id);
    if (!t) throw new BoardError("not_found", `task ${id} does not exist`);
    return t;
  }
}
