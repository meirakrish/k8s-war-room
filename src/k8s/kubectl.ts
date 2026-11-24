/**
 * Runs one kubectl command and returns its output as text.
 * Every k8s tool goes through here, so the safety rules live in one place.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Throws if `args` is not a read-only kubectl command. */
export function assertReadOnly(_args: readonly string[]): void {
  if (_args.length === 0) {
    throw new Error("no arguments found");
  }

  if (!(_args[0] && ["get", "logs", "describe", "events"].includes(_args[0]))) {
    throw new Error(`action ${_args[0]} not allowed`);
  }
}

/**
 * Runs `kubectl <args>` and resolves with its stdout.
 * Rejects if the command is not read-only, or if kubectl fails.
 */
export async function kubectl(_args: readonly string[], _opts: { context: string }): Promise<string> {
  assertReadOnly(_args);
  const { stdout } = await execFileAsync("kubectl", ["--context", _opts.context, ..._args]);
  return stdout;
}
