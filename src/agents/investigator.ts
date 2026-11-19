import type { Task } from "../board/types.ts";
import type { BoardClient } from "../mcp/board-client.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canned output per task type. The real agents will replace this with tool calls (kubectl logs, events, ...). */
function fakeFinding(task: Task): { content: string; evidence: string[] } {
  switch (task.type) {
    case "investigate_logs":
      return {
        content: "Container exits within a second of starting with a missing-config error",
        evidence: ["Error: DATABASE_URL is not set", "process exited with code 1"],
      };
    case "investigate_events":
      return {
        content: "Kubelet is restarting the container with exponential backoff",
        evidence: ["BackOff: Back-off restarting failed container", "restart count: 7"],
      };
    default:
      return { content: `No investigator knows how to handle '${task.type}'`, evidence: [] };
  }
}

/**
 * Fake investigator (no LLM). Its whole loop is the one the real agents will run:
 *
 *   look at open tasks -> try to claim one -> work on it -> post what it found -> complete it -> repeat
 *
 * The claim is the coordination point. Several investigators can run at once and they never talk to each other: they
 * look at the same open tasks, and the board decides who gets each one. Losing a claim just means "try the next one".
 *
 * Returns the ids of the tasks this agent completed.
 */
export async function runInvestigator(
  board: BoardClient,
  opts: { name: string; workMs?: number; idlePolls?: number; pollMs?: number },
): Promise<number[]> {
  const { name, workMs = 0, idlePolls = 3, pollMs = 100 } = opts;
  const completed: number[] = [];
  let idle = 0;

  while (idle < idlePolls) {
    const open = (await board.listOpenTasks()).filter((t) => t.type.startsWith("investigate_"));
    let didWork = false;

    for (const candidate of open) {
      const claim = await board.claimTask(name, candidate.id);
      if (!claim.claimed) continue; // someone else got it first

      await sleep(workMs); // stands in for the time real investigation takes
      const finding = fakeFinding(claim.task);
      await board.post({ agent: name, taskId: claim.task.id, kind: "finding", ...finding });
      await board.completeTask({
        agent: name,
        taskId: claim.task.id,
        status: "done",
        result: { summary: finding.content },
      });
      completed.push(claim.task.id);
      didWork = true;
      break; // re-read the board after every task: it may have changed while we worked
    }

    if (didWork) idle = 0;
    else {
      idle++;
      await sleep(pollMs);
    }
  }
  return completed;
}
