import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Anything that can run kubectl. Tools depend on this type, so tests can pass a fake that returns fixtures. */
export type Kubectl = (args: readonly string[]) => Promise<string>;

export class KubectlDenied extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KubectlDenied";
  }
}

/**
 * The only verbs this server will ever run. Milestone 2 is read-only; writes arrive in Milestone 4 behind an approval
 * gate, in a *separate* code path, so that "can this server change the cluster?" has a one-line answer: no.
 */
const READ_ONLY_VERBS = new Set(["get", "logs", "describe", "events"]);

/**
 * Refuse anything that isn't a read-only verb in first position. Requiring the verb to come first also blocks
 * `["--as=admin", "delete", ...]`-style tricks, because a leading flag is not a verb.
 *
 * This is the last line of defence, not the only one: tool inputs are validated one layer up too (see k8s-server.ts).
 */
export function assertReadOnly(args: readonly string[]): void {
  const verb = args[0];
  if (verb === undefined || !READ_ONLY_VERBS.has(verb)) {
    throw new KubectlDenied(
      `kubectl ${verb ?? "(nothing)"} is not allowed: this server is read-only (${[...READ_ONLY_VERBS].join(", ")})`,
    );
  }
}

/**
 * A real kubectl. Uses execFile, not a shell, so an argument can never be interpreted as shell syntax
 * (`; rm -rf /` is just a strange pod name). `context` pins the cluster: without it kubectl uses whatever the
 * current context happens to be, which is how people end up running things against production.
 */
export function createKubectl(opts: { context?: string; timeoutMs?: number } = {}): Kubectl {
  return async (args) => {
    assertReadOnly(args);
    const full = opts.context ? ["--context", opts.context, ...args] : [...args];
    const { stdout } = await run("kubectl", full, {
      timeout: opts.timeoutMs ?? 20_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };
}
