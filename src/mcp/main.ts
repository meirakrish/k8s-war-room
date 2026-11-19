// Entry point for board-mcp over stdio. A client spawns this as a child process, so each agent gets its own server
// process and its own SQLite connection to the same file: real cross-process contention, as in production.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Board } from "../board/board.ts";
import { createBoardServer } from "./board-server.ts";

const dbPath = process.env.BOARD_DB;
if (!dbPath) {
  console.error("board-mcp: set BOARD_DB to the SQLite file to use");
  process.exit(1);
}

// stdout carries the MCP protocol, so anything human-readable must go to stderr.
await createBoardServer(new Board(dbPath)).connect(new StdioServerTransport());
console.error(`board-mcp ready (db: ${dbPath})`);
