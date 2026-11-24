import { describe, expect, it } from "vitest";
import type { Skill } from "../src/skills/loader.ts";
import { describeSkills } from "../src/skills/describe.ts";

const oom: Skill = { name: "oomkilled", description: "Use when a container was OOMKilled.", body: "SECRET-OOM-BODY" };
const pull: Skill = {
  name: "image-pull-error",
  description: "Use when an image cannot be pulled.",
  body: "SECRET-PULL-BODY",
};

describe("describeSkills", () => {
  it("writes one line per skill: a dash, the name, a colon and the description", () => {
    expect(describeSkills([oom])).toBe("- oomkilled: Use when a container was OOMKilled.");
    expect(describeSkills([oom, pull]).split("\n")).toHaveLength(2);
  });

  it("keeps the order of the list it is given", () => {
    const lines = describeSkills([pull, oom]).split("\n");

    expect(lines[0]).toBe("- image-pull-error: Use when an image cannot be pulled.");
    expect(lines[1]).toBe("- oomkilled: Use when a container was OOMKilled.");
  });

  it("returns an empty string for an empty list, not a header with nothing under it", () => {
    expect(describeSkills([])).toBe("");
  });

  it("never includes the body of a skill", () => {
    const text = describeSkills([oom, pull]);

    expect(text).not.toContain("SECRET-OOM-BODY");
    expect(text).not.toContain("SECRET-PULL-BODY");
  });
});
