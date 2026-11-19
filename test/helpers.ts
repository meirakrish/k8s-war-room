import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

/** A fresh SQLite file path per call, removed after each test. */
export function useTempDb() {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  return () => {
    const dir = mkdtempSync(join(tmpdir(), "war-room-test-"));
    dirs.push(dir);
    return join(dir, "board.db");
  };
}
