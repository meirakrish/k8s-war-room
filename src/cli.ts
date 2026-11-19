import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Board } from "./board/board.ts";
import { runInvestigator } from "./agents/investigator.ts";
import { runTriage, type Incident } from "./agents/triage.ts";
import { BoardClient } from "./mcp/board-client.ts";

const INCIDENT: Incident = { pod: "checkout-7d9f", namespace: "shop", symptom: "CrashLoopBackOff" };

const usage = `usage:
  node src/cli.ts demo                      triage + two investigators on a throwaway board
  node src/cli.ts triage <db>               open an incident on <db>
  node src/cli.ts investigator <db> <name>  claim and investigate open tasks on <db>
  node src/cli.ts show <db>                 print tasks, posts and events from <db>`;

function show(board: Board) {
  console.log("\nTASKS");
  for (const t of board.listTasks()) {
    const parent = t.parentId ? ` (child of #${t.parentId})` : "";
    console.log(`  #${t.id} ${t.type.padEnd(18)} ${t.status.padEnd(7)} ${(t.claimedBy ?? "-").padEnd(16)}${parent}`);
  }
  console.log("\nPOSTS");
  for (const p of board.listPosts()) console.log(`  task #${p.taskId} [${p.kind}] ${p.agent}: ${p.content}`);
  console.log("\nEVENT LOG");
  for (const e of board.listEvents()) {
    console.log(`  ${String(e.id).padStart(2)} ${e.actor.padEnd(16)} ${e.type.padEnd(15)} task=${e.taskId ?? "-"}`);
  }
}

async function demo() {
  const dir = mkdtempSync(join(tmpdir(), "war-room-"));
  const db = join(dir, "board.db");
  try {
    // Each agent gets its own board-mcp process, hence its own SQLite connection to the same file.
    const triage = await BoardClient.spawn(db, "triage");
    const inv1 = await BoardClient.spawn(db, "investigator-1");
    const inv2 = await BoardClient.spawn(db, "investigator-2");

    await runTriage(triage, INCIDENT);
    // Both start at once and see the same open tasks. They never talk to each other; the board arbitrates.
    const [a, b] = await Promise.all([
      runInvestigator(inv1, { name: "investigator-1", workMs: 150 }),
      runInvestigator(inv2, { name: "investigator-2", workMs: 150 }),
    ]);
    console.log(`investigator-1 completed tasks ${JSON.stringify(a)}, investigator-2 completed ${JSON.stringify(b)}`);
    await Promise.all([triage.close(), inv1.close(), inv2.close()]);

    const board = new Board(db);
    show(board);
    board.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "demo") await demo();
else if (cmd === "triage" && args[0]) {
  const client = await BoardClient.spawn(args[0], "triage");
  console.log(await runTriage(client, INCIDENT));
  await client.close();
} else if (cmd === "investigator" && args[0] && args[1]) {
  const client = await BoardClient.spawn(args[0], args[1]);
  console.log(`${args[1]} completed`, await runInvestigator(client, { name: args[1], workMs: 1000, idlePolls: 20 }));
  await client.close();
} else if (cmd === "show" && args[0]) {
  const board = new Board(args[0]);
  show(board);
  board.close();
} else {
  console.error(usage);
  process.exit(1);
}
