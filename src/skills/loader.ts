import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Reads the skills folder: one sub-folder per skill, each with a SKILL.md file.
 *
 * A SKILL.md starts with a header between two `---` lines (`name:` and `description:`), followed by the runbook text.
 */

export interface Skill {
  /** Matches the skill's folder name, e.g. "oomkilled". */
  name: string;
  /** One line that says WHEN to use the skill. The model reads only this before opening it. */
  description: string;
  /** The runbook text, without the header. */
  body: string;
}

/**
 * Reads every skill in `dir`. Throws a clear error, naming the file, if a skill has no header,
 * is missing its name or description, or if its name does not match its folder.
 */

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// The header is the text between the first two `---` lines; the body is everything after the second one.
// `[\s\S]*?` stops at the FIRST closing `---`, so a `---` divider later in the body stays in the body.
const HEADER_AND_BODY = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Reads `key: value` lines. Only the first colon splits, so a value can contain colons. */
function parseHeader(header: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of header.split(/\r?\n/)) {
    const match = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields[match[1]] = match[2].trim();
    }
  }
  return fields;
}

export function loadSkills(_dir: string): Skill[] {
  const skills: Skill[] = [];

  for (const folder of readdirSync(_dir)) {
    if (!isDirectory(join(_dir, folder))) {
      continue; // a stray file, not a skill
    }

    const file = join(_dir, folder, "SKILL.md");
    if (!existsSync(file)) {
      throw new Error(`Skill "${folder}": there is no SKILL.md in its folder`);
    }

    const match = HEADER_AND_BODY.exec(readFileSync(file, "utf8"));
    if (!match) {
      throw new Error(`Skill "${folder}": SKILL.md has no header (it must start with a --- line)`);
    }

    const fields = parseHeader(match[1] ?? "");
    const name = fields["name"];
    const description = fields["description"];

    if (!name) {
      throw new Error(`Skill "${folder}": the header has no name`);
    }
    if (!description) {
      throw new Error(`Skill "${folder}": the header has no description`);
    }
    if (name !== folder) {
      throw new Error(`Skill "${folder}": the header name "${name}" does not match the folder name`);
    }

    skills.push({ name, description, body: (match[2] ?? "").trim() });
  }

  return skills;
}

/**
 * Finds a skill by name in an already loaded list. Returns undefined if there is none.
 * It searches the list; it never builds a file path from `name`.
 */
export function findSkill(_skills: readonly Skill[], _name: string): Skill | undefined {
  const skillDic: Record<string, Skill> = Object.fromEntries(_skills.map((skill) => [skill.name, skill]));
  return Object.hasOwn(skillDic, _name) ? skillDic[_name] : undefined;
}
