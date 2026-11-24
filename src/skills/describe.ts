import type { Skill } from "./loader.ts";

/**
 * Writes the skills list for the system prompt: one line per skill, "- <name>: <description>", in the order given.
 * The body is never included; the model asks for it with the load_skill tool.
 * Returns an empty string for an empty list.
 */
export function describeSkills(_skills: readonly Skill[]): string {
  return _skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
}
