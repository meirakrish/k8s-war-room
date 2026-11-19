import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { Board, BoardError } from "../src/board/board.ts";
import { useTempDb } from "./helpers.ts";

const newDb = useTempDb();

describe("tasks", () => {
  it("creates open tasks and lists them oldest first, optionally by type", () => {
    const board = new Board();
    const a = board.createTask({ actor: "triage", type: "investigate_logs", input: { pod: "x" } });
    const b = board.createTask({ actor: "triage", type: "investigate_events" });
    expect(a).toMatchObject({ status: "open", claimedBy: null, parentId: null, input: { pod: "x" }, result: null });
    expect(board.listOpenTasks().map((t) => t.id)).toEqual([a.id, b.id]);
    expect(board.listOpenTasks({ type: "investigate_events" }).map((t) => t.id)).toEqual([b.id]);
  });

  it("links children to a parent and rejects a parent that does not exist", () => {
    const board = new Board();
    const root = board.createTask({ actor: "triage", type: "incident" });
    expect(board.createTask({ actor: "triage", type: "x", parentId: root.id }).parentId).toBe(root.id);
    expect(() => board.createTask({ actor: "triage", type: "x", parentId: 999 })).toThrow(BoardError);
  });

  it("walks open -> claimed -> done and stores the result", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    expect(board.claimTask(t.id, "inv")).toMatchObject({
      claimed: true,
      task: { status: "claimed", claimedBy: "inv" },
    });
    expect(board.listOpenTasks()).toEqual([]);
    const done = board.completeTask({ id: t.id, agent: "inv", status: "done", result: { ok: true } });
    expect(done).toMatchObject({ status: "done", result: { ok: true } });
  });

  it("supports failing a task", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    board.claimTask(t.id, "inv");
    expect(board.completeTask({ id: t.id, agent: "inv", status: "failed" }).status).toBe("failed");
  });
});

describe("claiming", () => {
  it("lets exactly one of two agents claim a task", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    const first = board.claimTask(t.id, "a");
    const second = board.claimTask(t.id, "b");
    expect(first.claimed).toBe(true);
    expect(second).toEqual({ claimed: false, reason: `task ${t.id} is already claimed by a` });
    expect(board.getTask(t.id)?.claimedBy).toBe("a");
  });

  it("does not let the same agent claim twice, nor claim a finished task", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    board.claimTask(t.id, "a");
    expect(board.claimTask(t.id, "a").claimed).toBe(false);
    board.completeTask({ id: t.id, agent: "a", status: "done" });
    expect(board.claimTask(t.id, "b")).toMatchObject({ claimed: false, reason: expect.stringContaining("done") });
  });

  it("reports a missing task as a lost claim, not a crash", () => {
    expect(new Board().claimTask(42, "a")).toEqual({ claimed: false, reason: "task 42 does not exist" });
  });

  it("holds across separate connections to the same file (what separate agent processes get)", () => {
    const path = newDb();
    const one = new Board(path);
    const two = new Board(path);
    const t = one.createTask({ actor: "triage", type: "x" });
    expect(one.claimTask(t.id, "a").claimed).toBe(true);
    expect(two.claimTask(t.id, "b").claimed).toBe(false);
    one.close();
    two.close();
  });

  it("gives each of many tasks to exactly one of many contending connections", () => {
    const path = newDb();
    const boards = ["a", "b", "c", "d"].map((name) => ({ name, board: new Board(path) }));
    const ids = Array.from({ length: 20 }, () => boards[0]!.board.createTask({ actor: "t", type: "x" }).id);

    const wins = new Map<number, string[]>(ids.map((id) => [id, []]));
    for (const id of ids) {
      for (const { name, board } of boards) if (board.claimTask(id, name).claimed) wins.get(id)!.push(name);
    }
    for (const winners of wins.values()) expect(winners).toHaveLength(1);
    boards.forEach(({ board }) => board.close());
  });
});

describe("completing", () => {
  it("only lets the claiming agent complete, and only once", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    expect(() => board.completeTask({ id: t.id, agent: "a", status: "done" })).toThrow(/not claimed/);
    board.claimTask(t.id, "a");
    expect(() => board.completeTask({ id: t.id, agent: "b", status: "done" })).toThrow(/claimed by a, not b/);
    board.completeTask({ id: t.id, agent: "a", status: "done" });
    expect(() => board.completeTask({ id: t.id, agent: "a", status: "done" })).toThrow(/is done, not claimed/);
  });
});

describe("posts", () => {
  it("stores posts with evidence and returns them per task", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    const other = board.createTask({ actor: "triage", type: "x" });
    board.post({ taskId: t.id, agent: "inv", kind: "finding", content: "oom", evidence: ["Killed process 1"] });
    board.post({ taskId: other.id, agent: "inv", kind: "question", content: "which node?" });
    expect(board.listPosts(t.id)).toMatchObject([{ kind: "finding", content: "oom", evidence: ["Killed process 1"] }]);
    expect(board.listPosts()).toHaveLength(2);
  });

  it("lets agents post on tasks they do not own, but not on missing tasks or with unknown kinds", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    board.claimTask(t.id, "a");
    expect(board.post({ taskId: t.id, agent: "reviewer", kind: "decision", content: "ok" }).agent).toBe("reviewer");
    expect(() => board.post({ taskId: 99, agent: "a", kind: "finding", content: "x" })).toThrow(/does not exist/);
    expect(() => board.post({ taskId: t.id, agent: "a", kind: "gossip" as never, content: "x" })).toThrow(
      /unknown post kind/,
    );
  });
});

describe("event log", () => {
  it("records every state change in order, with the actor", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    board.claimTask(t.id, "inv");
    board.post({ taskId: t.id, agent: "inv", kind: "finding", content: "x" });
    board.completeTask({ id: t.id, agent: "inv", status: "done" });
    expect(board.listEvents().map((e) => [e.actor, e.type])).toEqual([
      ["triage", "task_created"],
      ["inv", "task_claimed"],
      ["inv", "post_added"],
      ["inv", "task_completed"],
    ]);
  });

  it("does not log a lost claim or a rejected call", () => {
    const board = new Board();
    const t = board.createTask({ actor: "triage", type: "x" });
    board.claimTask(t.id, "a");
    board.claimTask(t.id, "b");
    expect(() => board.completeTask({ id: t.id, agent: "b", status: "done" })).toThrow();
    expect(board.listEvents()).toHaveLength(2);
  });

  it("supports tailing with a cursor", () => {
    const board = new Board();
    board.createTask({ actor: "t", type: "x" });
    const seen = board.listEvents().at(-1)!.id;
    board.createTask({ actor: "t", type: "y" });
    expect(board.listEvents(seen)).toHaveLength(1);
  });

  it("is append-only: the database itself refuses UPDATE and DELETE", () => {
    const path = newDb();
    const board = new Board(path);
    board.createTask({ actor: "t", type: "x" });
    // A raw connection, bypassing the Board class, to prove the guarantee does not rely on application code.
    const raw = new DatabaseSync(path);
    expect(() => raw.exec("UPDATE events SET actor = 'mallory'")).toThrow(/append-only/);
    expect(() => raw.exec("DELETE FROM events")).toThrow(/append-only/);
    raw.close();
    board.close();
  });
});

describe("schema constraints", () => {
  it("refuses states the status machine forbids, even from raw SQL", () => {
    const path = newDb();
    new Board(path).close();
    const raw = new DatabaseSync(path);
    const now = "2026-01-01T00:00:00Z";
    expect(() =>
      raw.exec(`INSERT INTO tasks (type, status, created_at, updated_at) VALUES ('x', 'bogus', '${now}', '${now}')`),
    ).toThrow();
    expect(() =>
      raw.exec(`INSERT INTO tasks (type, status, created_at, updated_at) VALUES ('x', 'claimed', '${now}', '${now}')`),
    ).toThrow(); // claimed with no owner
    raw.close();
  });
});
