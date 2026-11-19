import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Board, BoardError } from "../board/board.ts";
import { POST_KINDS, type Json } from "../board/types.ts";

// zod schema for "any JSON value", used for the free-form input / result / evidence fields.
const json: z.ZodType<Json> = z.lazy(() =>
  z.union([z.null(), z.boolean(), z.number(), z.string(), z.array(json), z.record(z.string(), json)]),
);

const agent = z.string().min(1).describe("Your agent name, e.g. 'triage' or 'investigator-1'");

/** Every tool replies with JSON text. A BoardError (caller mistake) comes back as a tool error the agent can read. */
const reply = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });

async function guarded<T>(fn: () => T) {
  try {
    return reply(fn());
  } catch (err) {
    if (err instanceof BoardError) {
      return { isError: true, content: [{ type: "text" as const, text: `${err.code}: ${err.message}` }] };
    }
    throw err;
  }
}

/**
 * Builds the board-mcp server over a Board. The five tools below are the *entire* interface agents have to the shared
 * state; there is deliberately no tool to read events or list all tasks (those are for the UI and tests, not for agents
 * deciding what to do next).
 */
export function createBoardServer(board: Board): McpServer {
  const server = new McpServer({ name: "board-mcp", version: "0.1.0" });

  server.registerTool(
    "create_task",
    {
      description:
        "Open a new task on the board for another agent to claim. Use parent_id to link it to a task it came from.",
      inputSchema: {
        agent,
        type: z.string().min(1).describe("What kind of work this is, e.g. 'investigate_logs'"),
        input: json.optional().describe("Whatever the claiming agent needs to do the work"),
        parent_id: z.number().int().optional().describe("The task this one was spawned from"),
      },
    },
    ({ agent, type, input, parent_id }) =>
      guarded(() => board.createTask({ actor: agent, type, input, parentId: parent_id })),
  );

  server.registerTool(
    "list_open_tasks",
    {
      description: "List tasks nobody has claimed yet, oldest first. Optionally filter by type.",
      inputSchema: { type: z.string().optional() },
    },
    ({ type }) => guarded(() => board.listOpenTasks({ type })),
  );

  server.registerTool(
    "claim_task",
    {
      description:
        "Atomically claim an open task. Exactly one agent can win. Returns {claimed: true, task} or {claimed: false, reason}; " +
        "losing is normal, so just pick another task.",
      inputSchema: { agent, task_id: z.number().int() },
    },
    ({ agent, task_id }) => guarded(() => board.claimTask(task_id, agent)),
  );

  server.registerTool(
    "post",
    {
      description:
        "Post to a task: a finding, a hypothesis, a question, or a decision. Attach evidence when you have it.",
      inputSchema: {
        agent,
        task_id: z.number().int(),
        kind: z.enum(POST_KINDS),
        content: z.string().min(1),
        evidence: json.optional().describe("Supporting data: log lines, event names, URLs"),
      },
    },
    ({ agent, task_id, kind, content, evidence }) =>
      guarded(() => board.post({ agent, taskId: task_id, kind, content, evidence })),
  );

  server.registerTool(
    "complete_task",
    {
      description:
        "Finish a task you claimed, as done or failed, with an optional result. Only the claiming agent may do this.",
      inputSchema: { agent, task_id: z.number().int(), status: z.enum(["done", "failed"]), result: json.optional() },
    },
    ({ agent, task_id, status, result }) => guarded(() => board.completeTask({ id: task_id, agent, status, result })),
  );

  return server;
}
