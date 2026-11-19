import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fileURLToPath } from "node:url";
import type { ClaimResult, Json, Post, PostKind, Task } from "../board/types.ts";

const SERVER_ENTRY = fileURLToPath(new URL("./main.ts", import.meta.url));

/**
 * What an agent holds: a typed wrapper over an MCP client connected to board-mcp. Agents never see SQLite, only these
 * five calls. When the LLM agents arrive, the model will call the same tools directly through MCP; this wrapper is what
 * the scripted fake agents use in its place.
 */
export class BoardClient {
  readonly #client: Client;

  private constructor(client: Client) {
    this.#client = client;
  }

  /** Spawn board-mcp as a child process on the given database file. */
  static async spawn(dbPath: string, name: string): Promise<BoardClient> {
    return BoardClient.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--disable-warning=ExperimentalWarning", SERVER_ENTRY],
        env: { ...process.env, BOARD_DB: dbPath } as Record<string, string>,
        stderr: "ignore",
      }),
      name,
    );
  }

  static async connect(transport: Transport, name: string): Promise<BoardClient> {
    const client = new Client({ name, version: "0.1.0" });
    await client.connect(transport);
    return new BoardClient(client);
  }

  close(): Promise<void> {
    return this.#client.close();
  }

  listTools(): Promise<string[]> {
    return this.#client.listTools().then((r) => r.tools.map((t) => t.name));
  }

  createTask(args: { agent: string; type: string; input?: Json; parentId?: number }): Promise<Task> {
    return this.#call("create_task", {
      agent: args.agent,
      type: args.type,
      input: args.input,
      parent_id: args.parentId,
    });
  }

  listOpenTasks(type?: string): Promise<Task[]> {
    return this.#call("list_open_tasks", { type });
  }

  claimTask(agent: string, taskId: number): Promise<ClaimResult> {
    return this.#call("claim_task", { agent, task_id: taskId });
  }

  post(args: { agent: string; taskId: number; kind: PostKind; content: string; evidence?: Json }): Promise<Post> {
    return this.#call("post", {
      agent: args.agent,
      task_id: args.taskId,
      kind: args.kind,
      content: args.content,
      evidence: args.evidence,
    });
  }

  completeTask(args: { agent: string; taskId: number; status: "done" | "failed"; result?: Json }): Promise<Task> {
    return this.#call("complete_task", {
      agent: args.agent,
      task_id: args.taskId,
      status: args.status,
      result: args.result,
    });
  }

  async #call<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const res = await this.#client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text: string }[])[0]?.text ?? "";
    if (res.isError) throw new Error(`board-mcp ${name} failed: ${text}`);
    return JSON.parse(text) as T;
  }
}
