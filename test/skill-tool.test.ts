import { describe, expect, it } from "vitest";
import type { Skill } from "../src/skills/loader.ts";
import { loadSkillTool } from "../src/skills/tool.ts";

const skills: Skill[] = [
  {
    name: "oomkilled",
    description: "Use when a container was OOMKilled.",
    body: "# OOMKilled\n\nCheck the last reason.",
  },
  {
    name: "image-pull-error",
    description: "Use when an image cannot be pulled.",
    body: "# Image pull\n\nCheck the image name.",
  },
];

describe("loadSkillTool", () => {
  it("is called load_skill", () => {
    expect(loadSkillTool(skills).name).toBe("load_skill");
  });

  it("returns the body of a known skill, and only the body", async () => {
    const text = await loadSkillTool(skills).invoke({ name: "oomkilled" });

    expect(text).toBe("# OOMKilled\n\nCheck the last reason.");
  });

  it("throws for an unknown name, and the message lists the available skills", async () => {
    const call = loadSkillTool(skills).invoke({ name: "nope" });

    await expect(call).rejects.toThrow(/oomkilled/);
    await expect(call).rejects.toThrow(/image-pull-error/);
  });

  // The name comes from the model, so it must never reach the file system or match by accident.
  it.each([
    ["a path going up", "../oomkilled"],
    ["an absolute path", "/etc/passwd"],
    ["an empty name", ""],
    ["a built-in object key", "constructor"],
  ])("rejects %s", async (_why, name) => {
    await expect(loadSkillTool(skills).invoke({ name })).rejects.toThrow();
  });

  // The list contains a skill with this very long name, so a lookup would succeed.
  // The call can only fail if the schema rejects the name before the lookup.
  it("rejects a name that is too long, even if the list has a skill with that name", async () => {
    const tooLong = "a".repeat(500);
    const withLongSkill: Skill[] = [...skills, { name: tooLong, description: "d", body: "b" }];

    await expect(loadSkillTool(withLongSkill).invoke({ name: tooLong })).rejects.toThrow();
  });

  it("accepts a name of normal length that is in the list", async () => {
    await expect(loadSkillTool(skills).invoke({ name: "image-pull-error" })).resolves.toContain("Image pull");
  });
});
