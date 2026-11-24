import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { eventsTool, listPodsTool, namespaceSchema, podLogsTool, podNameSchema } from "../src/k8s/tools.ts";
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

describe("pod_logs tool", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["-f", "--all-containers", "Pod", "pod; ls", ""])(
    "rejects the pod name %j without running kubectl",
    async (pod) => {
      // a fake kubectl that leaves a marker file if it is ever run
      const dir = await useFakeKubectl(`touch "$(dirname "$0")/was-run"`);
      const tool = podLogsTool({ context: "war-room" });

      await expect(tool.invoke({ namespace: "shop", pod })).rejects.toThrow();
      expect(existsSync(join(dir, "was-run"))).toBe(false);
    },
  );

  it("adds --previous only when the model asks for it", async () => {
    // a fake kubectl that prints each argument it receives on its own line
    await useFakeKubectl(`printf '%s\\n' "$@"`);
    const tool = podLogsTool({ context: "war-room" });

    const without = String(await tool.invoke({ namespace: "shop", pod: "checkout-1" })).split("\n");
    const withPrevious = String(await tool.invoke({ namespace: "shop", pod: "checkout-1", previous: true })).split(
      "\n",
    );
    const explicitlyOff = String(await tool.invoke({ namespace: "shop", pod: "checkout-1", previous: false })).split(
      "\n",
    );

    expect(without).not.toContain("--previous");
    expect(explicitlyOff).not.toContain("--previous");
    expect(withPrevious).toContain("--previous");
  });

  it("cuts a huge log to a small size but keeps its end, where the error is", async () => {
    await useFakeKubectl(
      `i=0; while [ $i -lt 500 ]; do echo "noise noise noise noise noise noise noise"; i=$((i+1)); done; echo "FATAL: the real error"`,
    );
    const tool = podLogsTool({ context: "war-room" });

    const text = String(await tool.invoke({ namespace: "shop", pod: "checkout-1" }));

    expect(text.length).toBeLessThan(2000); // the raw output is about 21,000 characters
    expect(text).toContain("FATAL: the real error");
  });
});

describe("get_events tool", () => {
  afterEach(() => vi.unstubAllEnvs());
  const eventsFixture = new URL("./fixtures/events-shop.json", import.meta.url).pathname;

  it("has the name get_events and a description for the model", () => {
    const tool = eventsTool({ context: "war-room" });

    expect(tool.name).toBe("get_events");
    expect(tool.description.length).toBeGreaterThan(10);
  });

  it.each(["-A", "--all-namespaces", "shop; ls", "Shop", ""])(
    "rejects the namespace %j without running kubectl",
    async (namespace) => {
      const dir = await useFakeKubectl(`touch "$(dirname "$0")/was-run"`);
      const tool = eventsTool({ context: "war-room" });

      await expect(tool.invoke({ namespace })).rejects.toThrow();
      expect(existsSync(join(dir, "was-run"))).toBe(false);
    },
  );

  it.each(["-f", "--all-containers", "Pod", "pod; ls", ""])(
    "rejects the pod name %j without running kubectl",
    async (pod) => {
      const dir = await useFakeKubectl(`touch "$(dirname "$0")/was-run"`);
      const tool = eventsTool({ context: "war-room" });

      await expect(tool.invoke({ namespace: "shop", pod })).rejects.toThrow();
      expect(existsSync(join(dir, "was-run"))).toBe(false);
    },
  );

  it("asks kubectl for the events of one pod only when a pod is given", async () => {
    // a fake kubectl that saves the arguments it receives, and answers with an empty event list
    const dir = await useFakeKubectl(`printf '%s\\n' "$@" > "$(dirname "$0")/args"; echo '{"items":[]}'`);
    const tool = eventsTool({ context: "war-room" });
    const argsSent = () => readFileSync(join(dir, "args"), "utf8").trim().split("\n");

    await tool.invoke({ namespace: "shop" });
    expect(argsSent()).toEqual(expect.arrayContaining(["events", "-n", "shop", "-o", "json"]));
    expect(argsSent()).not.toContain("--for");

    await tool.invoke({ namespace: "shop", pod: "checkout-1" });
    expect(argsSent()).toEqual(expect.arrayContaining(["events", "-n", "shop", "--for", "pod/checkout-1"]));
  });

  it("returns the summary as JSON text, not the raw events", async () => {
    await useFakeKubectl(`cat "${eventsFixture}"`);
    const tool = eventsTool({ context: "war-room" });

    const text = String(await tool.invoke({ namespace: "shop" }));
    const events = JSON.parse(text);

    expect(Array.isArray(events)).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(events[0]).sort()).toEqual(["count", "lastSeen", "message", "object", "reason", "type"]);
  });

  it("when kubectl fails, kubectl's own error text is in the error the model gets", async () => {
    await useFakeKubectl(`echo 'Error from server (Forbidden): events is forbidden' >&2; exit 1`);
    const tool = eventsTool({ context: "war-room" });

    await expect(tool.invoke({ namespace: "shop" })).rejects.toThrow(/Forbidden/);
  });
});
