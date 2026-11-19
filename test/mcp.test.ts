import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { runInvestigator } from "../src/agents/investigator.ts";
import { runTriage } from "../src/agents/triage.ts";
import { Board } from "../src/board/board.ts";
import { BoardClient } from "../src/mcp/board-client.ts";
import { createBoardServer } from "../src/mcp/board-server.ts";
import { useTempDb } from "./helpers.ts";

const newDb = useTempDb();
const incident = { pod: "p", namespace: "ns", symptom: "CrashLoopBackOff" };

/** A client wired to a server over an in-memory pipe: same protocol, no child process. */
async function inMemoryClient(board: Board, name: string) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBoardServer(board).connect(serverSide);
  return BoardClient.connect(clientSide, name);
}

describe("board-mcp tools", () => {
  it("exposes exactly the five board tools", async () => {
    const client = await inMemoryClient(new Board(), "t");
    expect((await client.listTools()).sort()).toEqual([
      "claim_task",
      "complete_task",
      "create_task",
      "list_open_tasks",
      "post",
    ]);
  });

  it("runs the full task lifecycle over MCP", async () => {
    const board = new Board();
    const client = await inMemoryClient(board, "t");
    const task = await client.createTask({ agent: "triage", type: "investigate_logs", input: { pod: "p" } });
    expect((await client.listOpenTasks()).map((t) => t.id)).toEqual([task.id]);
    expect((await client.claimTask("inv", task.id)).claimed).toBe(true);
    await client.post({ agent: "inv", taskId: task.id, kind: "finding", content: "x", evidence: { line: 1 } });
    await client.completeTask({ agent: "inv", taskId: task.id, status: "done", result: { n: 1 } });
    expect(board.getTask(task.id)).toMatchObject({ status: "done", claimedBy: "inv", result: { n: 1 } });
  });

  it("returns a lost claim as data, but caller mistakes as tool errors", async () => {
    const client = await inMemoryClient(new Board(), "t");
    const task = await client.createTask({ agent: "triage", type: "x" });
    await client.claimTask("a", task.id);
    expect(await client.claimTask("b", task.id)).toMatchObject({ claimed: false });
    await expect(client.completeTask({ agent: "b", taskId: task.id, status: "done" })).rejects.toThrow(/not_owner/);
    await expect(client.post({ agent: "a", taskId: 99, kind: "finding", content: "x" })).rejects.toThrow(/not_found/);
  });

  it("validates input at the protocol boundary", async () => {
    const client = await inMemoryClient(new Board(), "t");
    // @ts-expect-error deliberately invalid kind, as a confused model might send
    await expect(client.post({ agent: "a", taskId: 1, kind: "gossip", content: "x" })).rejects.toThrow();
  });
});

describe("two agents in separate processes", () => {
  it("cannot claim the same task: exactly one wins the race", async () => {
    const db = newDb();
    const a = await BoardClient.spawn(db, "a");
    const b = await BoardClient.spawn(db, "b");
    try {
      const task = await a.createTask({ agent: "triage", type: "x" });
      // Fired together so both server processes are contending for the write lock at once.
      const [ra, rb] = await Promise.all([a.claimTask("a", task.id), b.claimTask("b", task.id)]);
      expect([ra.claimed, rb.claimed].filter(Boolean)).toHaveLength(1);

      const board = new Board(db);
      expect(board.getTask(task.id)?.claimedBy).toBe(ra.claimed ? "a" : "b");
      expect(board.listEvents().filter((e) => e.type === "task_claimed")).toHaveLength(1);
      board.close();
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  });
});

describe("fake agents", () => {
  it("triage opens an incident with hypotheses and two child tasks", async () => {
    const board = new Board();
    const triage = await inMemoryClient(board, "triage");
    const { rootId, spawned } = await runTriage(triage, incident);

    expect(board.getTask(rootId)).toMatchObject({ type: "incident", status: "done", claimedBy: "triage" });
    expect(board.listPosts(rootId).map((p) => p.kind)).toEqual(["hypothesis", "hypothesis", "hypothesis"]);
    expect(spawned.map((id) => board.getTask(id))).toMatchObject([
      { type: "investigate_logs", status: "open", parentId: rootId },
      { type: "investigate_events", status: "open", parentId: rootId },
    ]);
  });

  it("two concurrent investigators split the work: every task done once, one finding each", async () => {
    const db = newDb();
    const [triage, inv1, inv2] = await Promise.all(["triage", "inv-1", "inv-2"].map((n) => BoardClient.spawn(db, n)));
    try {
      const { spawned } = await runTriage(triage!, incident);
      const [a, b] = await Promise.all([
        runInvestigator(inv1!, { name: "inv-1", workMs: 50, idlePolls: 2, pollMs: 20 }),
        runInvestigator(inv2!, { name: "inv-2", workMs: 50, idlePolls: 2, pollMs: 20 }),
      ]);

      expect([...a, ...b].sort()).toEqual([...spawned].sort()); // nothing skipped, nothing done twice
      const board = new Board(db);
      for (const id of spawned) {
        expect(board.getTask(id)?.status).toBe("done");
        expect(board.listPosts(id).filter((p) => p.kind === "finding")).toHaveLength(1);
      }
      board.close();
    } finally {
      await Promise.all([triage!.close(), inv1!.close(), inv2!.close()]);
    }
  });

  it("an investigator on an empty board exits instead of spinning forever", async () => {
    const client = await inMemoryClient(new Board(), "inv");
    expect(await runInvestigator(client, { name: "inv", idlePolls: 2, pollMs: 5 })).toEqual([]);
  });
});
