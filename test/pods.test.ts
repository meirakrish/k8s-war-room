import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { summarizePods } from "../src/k8s/pods.ts";

// Real output captured from the cluster: test/fixtures/pods-shop.json (frontend x2, checkout, payments, recommender)
const podList = JSON.parse(readFileSync(new URL("./fixtures/pods-shop.json", import.meta.url), "utf8"));

describe("summarizePods", () => {
  it("healthy pod (frontend): phase Running, ready 1/1, container running", () => {
    const summaries = summarizePods(podList);
    const frontend = summaries.find((p) => p.name.startsWith("frontend-"));

    expect(frontend).toMatchObject({
      phase: "Running",
      readyCount: 1,
      totalCount: 1,
      containers: [{ name: "nginx", state: "running", restartCount: 0 }],
    });
  });

  it.todo("crashed pod (checkout): container terminated with exitCode 1, restarts > 0");
  it.todo("image pull error (payments): waiting, reason ImagePullBackOff, message included");
  it.todo("the trap (recommender): state is CrashLoopBackOff but lastReason is OOMKilled, lastExitCode 137");
  it.todo("a pod with no container statuses yet (Pending) does not crash the summary");
  it.todo("the summary is much smaller than the raw JSON");
});
