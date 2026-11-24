import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findSkill, loadSkills, type Skill } from "../src/skills/loader.ts";

/** Makes a temporary skills folder. `files` maps a skill's folder name to the full text of its SKILL.md. */
function makeSkillsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "skills-"));
  for (const [folder, text] of Object.entries(files)) {
    mkdirSync(join(dir, folder));
    writeFileSync(join(dir, folder, "SKILL.md"), text);
  }
  return dir;
}

// A valid skill file, for tests that need one.
const validSkill = (name: string) =>
  `---\nname: ${name}\ndescription: Use when ${name} happens.\n---\n\n# ${name}\n\nSteps.\n`;

describe("loadSkills", () => {
  it("reads a valid skill into a name, a description and a body (the body has no header)", () => {
    const dir = makeSkillsDir({ oomkilled: validSkill("oomkilled") });

    const [skill] = loadSkills(dir);

    expect(skill?.name).toBe("oomkilled");
    expect(skill?.description).toBe("Use when oomkilled happens.");
    expect(skill?.body).toContain("# oomkilled");
    expect(skill?.body).toContain("Steps.");
    expect(skill?.body).not.toContain("description:");
    expect(skill?.body).not.toContain("---");
  });

  it("reads every skill in the folder", () => {
    const dir = makeSkillsDir({
      oomkilled: validSkill("oomkilled"),
      "image-pull-error": validSkill("image-pull-error"),
      "crashloop-backoff": validSkill("crashloop-backoff"),
    });

    const names = loadSkills(dir)
      .map((s) => s.name)
      .sort();

    expect(names).toEqual(["crashloop-backoff", "image-pull-error", "oomkilled"]);
  });

  // The folder names below are chosen so that they do not appear in a generic message like "Skill is broken".
  // That way a test can only pass if the error really names the skill.
  it("throws, naming the skill, when a SKILL.md has no header", () => {
    const dir = makeSkillsDir({ "plain-runbook": "# Just a runbook, no header\n\nSteps.\n" });

    expect(() => loadSkills(dir)).toThrow(/plain-runbook/);
  });

  it("throws, naming the skill and the field, when the header has no name", () => {
    const dir = makeSkillsDir({ alpha: "---\ndescription: Use when something.\n---\n\n# x\n" });

    expect(() => loadSkills(dir)).toThrow(/alpha/);
    expect(() => loadSkills(dir)).toThrow(/name/);
  });

  it("throws, naming the skill and the field, when the header has no description", () => {
    const dir = makeSkillsDir({ beta: "---\nname: beta\n---\n\n# x\n" });

    expect(() => loadSkills(dir)).toThrow(/beta/);
    expect(() => loadSkills(dir)).toThrow(/description/);
  });

  it("a description that mentions 'name:' does not count as having a name", () => {
    const dir = makeSkillsDir({ gamma: "---\ndescription: Use when a field name: is missing.\n---\n\n# x\n" });

    // the error must say the name is missing, not something else (like "name does not match")
    expect(() => loadSkills(dir)).toThrow(/(no|missing) name/i);
  });

  it("reads the header fields in any order", () => {
    const dir = makeSkillsDir({
      delta: "---\ndescription: Use when delta happens.\nname: delta\n---\n\n# delta\n\nSteps.\n",
    });

    const [skill] = loadSkills(dir);

    expect(skill?.name).toBe("delta");
    expect(skill?.description).toBe("Use when delta happens.");
  });

  it("keeps the whole body when the runbook has a '---' divider in it", () => {
    const dir = makeSkillsDir({
      epsilon: `---\nname: epsilon\ndescription: Use when epsilon.\n---\n\n# epsilon\n\nPart one.\n\n---\n\nPart two.\n`,
    });

    const [skill] = loadSkills(dir);

    expect(skill?.body).toContain("Part one.");
    expect(skill?.body).toContain("Part two.");
  });

  it("reads a file with Windows line endings (\\r\\n)", () => {
    const text = validSkill("zeta").replaceAll("\n", "\r\n");
    const dir = makeSkillsDir({ zeta: text });

    const [skill] = loadSkills(dir);

    expect(skill?.name).toBe("zeta");
    expect(skill?.description).toBe("Use when zeta happens.");
    expect(skill?.body).toContain("Steps.");
  });

  it("ignores a stray file in the skills folder (it is not a skill)", () => {
    const dir = makeSkillsDir({ eta: validSkill("eta") });
    writeFileSync(join(dir, "README.md"), "Not a skill.");

    expect(loadSkills(dir).map((s) => s.name)).toEqual(["eta"]);
  });

  it("throws, naming the folder, when a skill folder has no SKILL.md", () => {
    const dir = makeSkillsDir({});
    mkdirSync(join(dir, "theta"));

    expect(() => loadSkills(dir)).toThrow(/theta/);
  });

  it("throws when the name in the header does not match the folder name", () => {
    const dir = makeSkillsDir({ "a-folder": validSkill("b-name") });

    expect(() => loadSkills(dir)).toThrow(/a-folder/);
  });

  it("a description that contains a colon or a comma is read whole", () => {
    const description = "Use when: pods fail, hang, or restart: see the events.";
    const dir = makeSkillsDir({ tricky: `---\nname: tricky\ndescription: ${description}\n---\n\n# tricky\n` });

    const [skill] = loadSkills(dir);

    expect(skill?.description).toBe(description);
  });

  it("throws a clear error when the skills folder does not exist", () => {
    expect(() => loadSkills(join(tmpdir(), "no-such-skills-folder"))).toThrow();
  });
});

describe("findSkill", () => {
  const skills: Skill[] = [
    { name: "oomkilled", description: "d1", body: "b1" },
    { name: "image-pull-error", description: "d2", body: "b2" },
  ];

  it("finds a skill by name", () => {
    expect(findSkill(skills, "oomkilled")?.body).toBe("b1");
  });

  it("returns undefined for an unknown name", () => {
    expect(findSkill(skills, "nope")).toBeUndefined();
  });

  it.each(["../../secrets", "../oomkilled", "oomkilled/../oomkilled", "/etc/passwd", ""])(
    "returns undefined for the name %j (it only searches the list)",
    (name) => {
      expect(findSkill(skills, name)).toBeUndefined();
    },
  );

  // Every JavaScript object has these keys without you adding them. A name taken from the model must not match them.
  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "returns undefined for the built-in object key %j",
    (name) => {
      expect(findSkill(skills, name)).toBeUndefined();
    },
  );
});

describe("the real skills folder", () => {
  it("every skill in skills/ loads without an error, and has a description and a body", () => {
    const skills = loadSkills(new URL("../skills", import.meta.url).pathname);

    expect(skills.map((s) => s.name)).toContain("oomkilled");
    for (const s of skills) {
      expect(s.description.length).toBeGreaterThan(10);
      expect(s.body.length).toBeGreaterThan(50);
    }
  });
});
