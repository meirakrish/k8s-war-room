import { existsSync } from "node:fs";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPodsTool, namespaceSchema, podNameSchema } from "../src/k8s/tools.ts";
// Tip: a fake `kubectl` on PATH (see test/kubectl.test.ts) can print test/fixtures/pods-shop.json.

describe("namespaceSchema", () => {
  it.each(["shop", "kube-system", "team-a1", "a", "9", "0a", "a--b", "a".repeat(63)])("accepts %j", (name) => {
    expect(namespaceSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ["uppercase", "Shop"],
    ["starts with a dash", "-A"],
    ["a flag", "--all-namespaces"],
    ["a space and a semicolon", "shop; ls"],
    ["a trailing dash", "shop-"],
    ["an empty string", ""],
    ["too long (64 characters)", "a".repeat(64)],
    ["an underscore", "my_shop"],
    ["a dot", "a.b"],
    ["a trailing newline", "shop\n"],
    ["a non-ASCII letter", "é"],
    ["a semicolon at the end", "shop;"],
    ["an underscore at the end", "shop_"],
    ["a dot at the end", "shop."],
    ["an exclamation mark at the end", "shop!"],
  ])("rejects %s", (_why, name) => {
    expect(namespaceSchema.safeParse(name).success).toBe(false);
  });
});

describe("podNameSchema", () => {
  it("answers quickly even for a long invalid name (no catastrophic backtracking)", () => {
    const start = Date.now();
    expect(podNameSchema.safeParse("a".repeat(40) + "!").success).toBe(false);
    expect(Date.now() - start).toBeLessThan(100);
  });

  it.each([
    "checkout-d6466c98c-zn5qd",
    "frontend-1",
    "a",
    "9",
    "my.pod",
    "a.b-c.d",
    "a--b",
    "ab--c",
    "pod-a--1",
    "a".repeat(253),
  ])("accepts %j", (name) => {
    expect(podNameSchema.safeParse(name).success).toBe(true);
  });

  it.each([
    ["a flag", "-f"],
    ["a long flag", "--all-containers"],
    ["uppercase", "Pod"],
    ["a space and a semicolon", "pod; ls"],
    ["a leading dash", "-pod"],
    ["a trailing dash", "pod-"],
    ["a leading dot", ".pod"],
    ["a trailing dot", "pod."],
    ["two dots in a row", "a..b"],
    ["a dash right after a dot", "a.-b"],
    ["an empty string", ""],
    ["too long (254 characters)", "a".repeat(254)],
    ["an underscore", "my_pod"],
    ["a trailing newline", "pod\n"],
    ["a non-ASCII letter", "é"],
  ])("rejects %s", (_why, name) => {
    expect(podNameSchema.safeParse(name).success).toBe(false);
  });
});

/** Puts a fake `kubectl` first in PATH, running the given shell script. Returns the folder it lives in. */
async function useFakeKubectl(script: string) {
  const dir = await mkdtemp(join(tmpdir(), "fake-kubectl-"));
  await writeFile(join(dir, "kubectl"), `#!/bin/sh\n${script}\n`);
  await chmod(join(dir, "kubectl"), 0o755);
  vi.stubEnv("PATH", `${dir}:${process.env.PATH}`);
  return dir;
}

describe("list_pods tool", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("has the name list_pods and a description for the model", () => {
    const tool = listPodsTool({ context: "war-room" });

    expect(tool.name).toBe("list_pods");
    // the model reads the description to decide when to call the tool, so it must say something
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it("runs `kubectl get pods -n <namespace> -o json` with the given context and returns the summary as JSON text", async () => {
    const tool = listPodsTool({ context: "war-room" });
    const xx = await tool.invoke({ namespace: "shop" });
    expect(typeof xx).toBe("string");
    expect(() => JSON.parse(xx)).not.toThrow();
  });

  it.each(["-A", "--all-namespaces", "shop; ls", "Shop", ""])(
    "rejects the namespace %j without running kubectl",
    async (namespace) => {
      // a fake kubectl that leaves a marker file if it is ever run
      const dir = await useFakeKubectl(`touch "$(dirname "$0")/was-run"`);
      const tool = listPodsTool({ context: "war-room" });

      await expect(tool.invoke({ namespace })).rejects.toThrow();
      expect(existsSync(join(dir, "was-run"))).toBe(false);
    },
  );
  it("when kubectl fails, kubectl's own error text is in the error the model gets", async () => {
    await useFakeKubectl(`echo 'Error from server (Forbidden): pods is forbidden' >&2; exit 1`);
    const tool = listPodsTool({ context: "war-room" });

    await expect(tool.invoke({ namespace: "shop" })).rejects.toThrow(/Forbidden/);
  });
});
