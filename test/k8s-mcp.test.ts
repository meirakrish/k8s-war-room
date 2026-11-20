import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Kubectl } from "../src/k8s/kubectl.ts";
import { createK8sServer } from "../src/mcp/k8s-server.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

/** A kubectl that records its arguments and answers from recorded cluster output. No cluster needed. */
function fakeKubectl(answers: Record<string, string>) {
  const calls: string[][] = [];

  const kubectl: Kubectl = async (args) => {
    calls.push([...args]);

    const cleanArgs = args.filter((x) => !["-n", "--for"].includes(x)).map((x) => x.replace("pod/", ""));
    const key = cleanArgs[0] + " " + cleanArgs[1];
    const out = answers[key];
    if (out === undefined) throw new Error(`fakeKubectl: no answer for ${args.join(" ")}, key is ${key}`);
    return out;
  };

  return { kubectl, calls };
}

async function connect(kubectl: Kubectl) {
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createK8sServer(kubectl).connect(s);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(c);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    const body = (res.content as { text: string }[])[0]!.text;
    return { isError: Boolean(res.isError), body };
  };
  return { client, call };
}

describe("list_pods", () => {
  const pods = () => fakeKubectl({ "get pods": fixture("pods-shop.json") });

  it("summarises each pod so the cause is visible", async () => {
    const { kubectl, calls } = pods();
    const { call } = await connect(kubectl);
    const res = await call("list_pods", { namespace: "shop" });
    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["get", "pods", "-n", "shop", "-o", "json"]);

    const byName = (prefix: string) => JSON.parse(res.body).find((p: { name: string }) => p.name.startsWith(prefix));
    expect(byName("frontend-")).toMatchObject({ phase: "Running", ready: "1/1" });
    expect(byName("checkout-").containers[0]).toMatchObject({ state: { exitCode: 1 }, restarts: expect.any(Number) });
    expect(byName("payments-").containers[0].state).toMatchObject({ kind: "waiting", reason: "ImagePullBackOff" });
    // The trap: current state says CrashLoopBackOff, the real cause is only in lastTerminated.
    expect(byName("recommender-").containers[0]).toMatchObject({
      state: { reason: "CrashLoopBackOff" },
      lastTerminated: { reason: "OOMKilled", exitCode: 137 },
    });
  });

  it("returns far less text than raw kubectl would", async () => {
    const { call } = await connect(pods().kubectl);
    expect((await call("list_pods", { namespace: "shop" })).body.length).toBeLessThan(
      fixture("pods-shop.json").length / 10,
    );
  });

  it.each([["-A"], ["--all-namespaces"], ["shop; rm -rf /"], ["Shop"], [""]])(
    "rejects namespace %j before kubectl runs",
    async (namespace) => {
      const { kubectl, calls } = pods();
      const { call } = await connect(kubectl);
      expect((await call("list_pods", { namespace })).isError).toBe(true);
      expect(calls).toEqual([]);
    },
  );

  it("passes kubectl's stderr to the model as a tool error", async () => {
    const kubectl: Kubectl = async () => {
      throw Object.assign(new Error("exit 1"), {
        stderr: 'Error from server (NotFound): namespaces "nope" not found\n',
      });
    };
    const res = await (await connect(kubectl)).call("list_pods", { namespace: "nope" });
    expect(res).toEqual({ isError: true, body: 'Error from server (NotFound): namespaces "nope" not found' });
  });
});

describe("get_pod_logs", () => {
  const logs = () => fakeKubectl({ "logs checkout-d6466c98c-zn5qd": fixture("logs-checkout.txt") });

  it("passes pod, namespace and --previous to kubectl", async () => {
    const { kubectl, calls } = logs();
    const { call } = await connect(kubectl);
    const res = await call("get_pod_logs", { pod: "checkout-d6466c98c-zn5qd", namespace: "shop", previous: true });
    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["logs", "checkout-d6466c98c-zn5qd", "-n", "shop", "--previous"]);
  });

  it("omits --previous when previous is not given: calls[0] is exactly [logs, <pod>, -n, shop]", async () => {
    const { kubectl, calls } = logs();
    const { call } = await connect(kubectl);
    const res = await call("get_pod_logs", { pod: "checkout-d6466c98c-zn5qd", namespace: "shop" });
    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["logs", "checkout-d6466c98c-zn5qd", "-n", "shop"]);
  });

  it("truncates huge logs: input is 'noise\\n' x 20000 + 'FATAL: the real error'; the body is under your size budget AND still contains the FATAL line", async () => {
    const huge = "noise\n".repeat(20_000) + "FATAL: the real error\n";
    const { kubectl } = fakeKubectl({ "logs checkout-d6466c98c-zn5qd": huge });
    const { call } = await connect(kubectl);

    const res = await call("get_pod_logs", { pod: "checkout-d6466c98c-zn5qd", namespace: "shop" });
    expect(res.isError).toBe(false);
    expect(res.body.length).toBeLessThan(4000);
    expect(res.body).toContain("FATAL: the real error");
  });

  it("rejects a pod name that looks like a flag ('-f', '--all-containers'): isError is true and calls is empty", async () => {
    const { kubectl, calls } = logs();
    const { call } = await connect(kubectl);
    const res = await call("get_pod_logs", { pod: "--all-containers", namespace: "shop" });
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("when --previous fails (pod never restarted): decide whether to pass kubectl's error through or reword it, then test it", async () => {
    const prevNotFound =
      'Error from server (BadRequest): previous terminated container "nginx" in pod "frontend-7bb584f994-pc424" not found';

    const kubectl: Kubectl = async () => {
      throw Object.assign(new Error("exit 1"), { stderr: prevNotFound });
    };

    const { call } = await connect(kubectl);

    const res = await call("get_pod_logs", { pod: "frontend-7bb584f994-pc424", namespace: "shop", previous: true });
    expect(res.isError).toBe(true);
    expect(res.body).toContain("previous pod does not found");
  });
});

describe("get_events", () => {
  const nsEvents = () => fakeKubectl({ "events shop": fixture("events-shop.json") });

  it("get_events: returns one entry per event with only {type, reason, object, message, count, lastSeen}, not the raw JSON", async () => {
    const { kubectl, calls } = nsEvents();
    const { call } = await connect(kubectl);
    const res = await call("get_events", { namespace: "shop" });

    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["events", "-n", "shop", "-o", "json"]);

    const events = JSON.parse(res.body);
    expect(events.length).toBe(JSON.parse(fixture("events-shop.json")).items.length);

    expect(events[0]).toMatchObject({
      type: "Warning",
      reason: "FailedScheduling",
      object: { kind: "Pod", name: "checkout-d6466c98c-zn5qd", namespace: "shop" },
      message:
        "0/1 nodes are available: 1 node(s) had untolerated taint(s). preemption: 0/1 nodes are available: 1 Preemption is not helpful for scheduling.",
      count: 1,
      lastSeen: "2026-11-19T15:17:57Z",
    });

    expect(Object.keys(events[0]).sort()).toEqual(["count", "lastSeen", "message", "object", "reason", "type"]);
  });

  it("get_events: sorted oldest first, so the newest event is last", async () => {
    const { kubectl, calls } = nsEvents();
    const { call } = await connect(kubectl);
    const res = await call("get_events", { namespace: "shop" });

    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["events", "-n", "shop", "-o", "json"]);
    const events = JSON.parse(res.body);

    const firstEvent = events[0];
    const lastEvent = events[events.length - 1];

    expect(Date.parse(firstEvent.lastSeen)).toBeLessThan(Date.parse(lastEvent.lastSeen));
  });

  it("get_events: with pod set, returns only that pod's events (the tool sends a field selector for it)", async () => {
    const filtered = JSON.parse(fixture("events-shop.json")).items.filter(
      (x: { involvedObject: { name: string } }) => x.involvedObject.name === "recommender-5c5b6ccfbc",
    );
    const filFix = JSON.stringify({ items: filtered });
    const podEvents = () => fakeKubectl({ "events recommender-5c5b6ccfbc": filFix });
    const { kubectl, calls } = podEvents();
    const { call } = await connect(kubectl);
    const res = await call("get_events", { pod: "recommender-5c5b6ccfbc", namespace: "shop" });

    expect(res.isError).toBe(false);
    expect(calls[0]).toEqual(["events", "--for", "pod/recommender-5c5b6ccfbc", "-n", "shop", "-o", "json"]);
  });

  it("get_events: rejects a namespace or pod that looks like a flag: isError is true and calls is empty", async () => {
    const { kubectl, calls } = nsEvents();
    const { call } = await connect(kubectl);
    const res = await call("get_events", { namespace: "-A" });

    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);

    const res2 = await call("get_events", { pod: "-w", namespace: "shop" });
    expect(res2.isError).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("tools exposed", () => {
  it("is read-only and, so far, has only the worked example", async () => {
    const { client } = await connect(fakeKubectl({}).kubectl);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["list_pods", "get_pod_logs", "get_events"]);
  });
});
