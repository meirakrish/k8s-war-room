import type { BoardClient } from "../mcp/board-client.ts";

export interface Incident {
  pod: string;
  namespace: string;
  symptom: string;
}

/**
 * Fake Triage (no LLM). It plays the role the real one will: turn an incident into hypotheses and investigation tasks.
 * Everything it does goes through board-mcp, and it never mentions another agent by name. It writes tasks to the
 * board and trusts that *someone* with the right skill will claim them.
 *
 * Shape on the board:
 *   incident (root task, owned by triage)
 *     |- hypothesis posts (what might be wrong)
 *     |- investigate_logs   (child task)
 *     `- investigate_events (child task)
 */
export async function runTriage(board: BoardClient, incident: Incident, name = "triage") {
  const root = await board.createTask({ agent: name, type: "incident", input: { ...incident } });
  const claim = await board.claimTask(name, root.id);
  if (!claim.claimed) throw new Error(`triage could not claim its own incident task: ${claim.reason}`);

  const hypotheses = [
    "Container is crash-looping because the process exits on startup",
    "Container was OOMKilled: memory limit is lower than actual usage",
    "Bad rollout: the latest image or config change broke the pod",
  ];
  for (const h of hypotheses) {
    await board.post({ agent: name, taskId: root.id, kind: "hypothesis", content: h });
  }

  const spawned = [];
  for (const type of ["investigate_logs", "investigate_events"]) {
    const child = await board.createTask({ agent: name, type, parentId: root.id, input: { ...incident } });
    spawned.push(child.id);
  }

  // In this milestone, triage's own work ends once the investigation is queued.
  await board.completeTask({ agent: name, taskId: root.id, status: "done", result: { spawned } });
  return { rootId: root.id, spawned };
}
