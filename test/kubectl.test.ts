import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { assertReadOnly, kubectl } from "../src/k8s/kubectl.ts";

describe("assertReadOnly", () => {
  it("allows read verbs: get, logs, describe", () => {
    expect(() => assertReadOnly(["get", "pods", "-n", "shop"])).not.toThrow();
    expect(() => assertReadOnly(["describe", "pod", "pawn", "-n", "shop"])).not.toThrow();
  });

  it("allows the events verb", () => {
    expect(() => assertReadOnly(["events", "-n", "shop"])).not.toThrow();
    expect(() => assertReadOnly(["events", "-n", "shop", "--for", "pod/checkout-1"])).not.toThrow();
  });

  it("refuses write verbs: delete, apply, patch, scale, exec, edit", () => {
    expect(() => assertReadOnly(["delete", "pod", "x"])).toThrow();
    expect(() => assertReadOnly(["apply", "xxx.yaml"])).toThrow();
    expect(() => assertReadOnly(["patch", "service/moshe"])).toThrow();
    expect(() => assertReadOnly(["scale", "replicaset", "5"])).toThrow();
    expect(() => assertReadOnly(["exec", "rm -rf /"])).toThrow();
    expect(() => assertReadOnly(["edit", "service", "service/moshe"])).toThrow();
  });

  it("requires the verb first, so a leading flag cannot hide a write: ['--as=admin', 'delete', ...]", () => {
    expect(() => assertReadOnly(["--as=admin", "delete", "pod"])).toThrow();
  });

  it("refuses an empty argument list", () => {
    expect(() => assertReadOnly([])).toThrow();
  });
});

/** Puts a fake `kubectl` first in PATH. It prints each argument it receives on its own line. */
async function useFakeKubectl() {
  const dir = await mkdtemp(join(tmpdir(), "fake-kubectl-"));
  await writeFile(join(dir, "kubectl"), "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
  await chmod(join(dir, "kubectl"), 0o755);
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
}

describe("kubectl", () => {
  it("does not run kubectl at all for a write verb", async () => {
    await expect(() => kubectl(["delete", "pod", "x", "-n", "shop"], { context: "war-room" })).rejects.toThrow();
  });

  it("passes the context to kubectl with --context", async () => {
    await useFakeKubectl();
    try {
      const out = await kubectl(["get", "pods", "-n", "shop"], { context: "war-room" });
      expect(out.trim().split("\n")).toEqual(["--context", "war-room", "get", "pods", "-n", "shop"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("passes arguments as a list, never through a shell", async () => {
    await useFakeKubectl();

    try {
      const out = await kubectl(["get", "pods", "-n", "x; echo HACKED"], { context: "war-room" });
      const lines = out.trim().split("\n");

      // the odd string arrived as ONE argument, so no shell read the `;`
      expect(lines).toContain("x; echo HACKED");
      // and nothing was run as a separate command
      expect(lines).not.toContain("HACKED");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
