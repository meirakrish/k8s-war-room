import { type StructuredToolInterface, tool } from "@langchain/core/tools";
import { z } from "zod";
import { type Skill, findSkill } from "./loader.ts";

export const nameSchema = z.string().describe("The name of the skill to load").max(63, "Must be at most 63 characters");

const loadSkillToolSchema = z.object({ name: nameSchema });

export const loadSkillTool = (_skills: Skill[]): StructuredToolInterface =>
  tool(
    async ({ name }: { name: string }) => {
      const skill: Skill | undefined = findSkill(_skills, name);

      if (!skill) {
        throw new Error(`Skill ${name} was not found, available skills are: ${_skills.map((s) => s.name).join(",")}`);
      }

      return skill.body;
    },
    {
      name: "load_skill",
      description:
        "Loads the full runbook of one skill, by its exact name from the skills list. " +
        "Call it when a skill's description matches what you see, before you decide the cause, " +
        "and follow the runbook. Returns the runbook text. An unknown name returns an error listing the valid names.",
      schema: loadSkillToolSchema,
    },
  );
