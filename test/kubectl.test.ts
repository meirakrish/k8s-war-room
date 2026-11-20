import { describe, expect, it } from "vitest";
import { assertReadOnly, KubectlDenied } from "../src/k8s/kubectl.ts";

describe("assertReadOnly", () => {
  it.each([["get"], ["logs"], ["describe"], ["events"]])("allows %s", (verb) => {
    expect(() => assertReadOnly([verb, "pods"])).not.toThrow();
  });

  it.each([["delete"], ["apply"], ["patch"], ["scale"], ["exec"], ["edit"], ["rollout"], ["cp"], ["port-forward"]])(
    "refuses %s",
    (verb) => {
      expect(() => assertReadOnly([verb, "pod/x"])).toThrow(KubectlDenied);
    },
  );

  it("requires the verb first, so a leading flag cannot hide a write", () => {
    expect(() => assertReadOnly(["--as=admin", "delete", "pod", "x"])).toThrow(KubectlDenied);
    expect(() => assertReadOnly([])).toThrow(KubectlDenied);
  });
});
