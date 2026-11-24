// Runs the agent once and prints the transcript. Run: pnpm investigate
import { createLlmClient, resolveLlmConfig } from "@meirakrish/llm-kit";
import { runAgentLoop, type LoopOptions, type LoopResult } from "./agents/loop.ts";
import { AIMessage } from "@langchain/core/messages";
import { listPodsTool, podLogsTool, eventsTool } from "./k8s/tools.ts";
import { loadSkillTool } from "./skills/tool.ts";
import { loadSkills } from "./skills/loader.ts";
import { describeSkills } from "./skills/describe.ts";
import { join } from "node:path";

const context = "war-room";
const skillsDir = join(import.meta.dirname, "../skills");
const llmConfig = resolveLlmConfig();
const llm = await createLlmClient(llmConfig);
const skills = loadSkills(skillsDir);
const skillsDesc = describeSkills(skills);
console.log("model", llm.model);

const systemPrompt =
  "You are a Kubernetes incident investigator. You can only read the cluster, never change it. " +
  "Work in this order:" +
  "\n" +
  "(1) list the pods to see which are unhealthy; " +
  "\n" +
  "(2) Before you read any logs or events for a pod, check the skills below. If the pod matches a skill's description, call load_skill with that skill's name, then follow the runbook, including its instructions for how to report. Skills: " +
  skillsDesc +
  "\n" +
  "(3) for EVERY unhealthy pod, call a tool to find out why before you answer: read its logs if its container has run, " +
  "and read its events if it never started (Pending, image pull or scheduling problems); " +
  "\n" +
  "(4) answer. Do not answer while an unhealthy pod still has no cause from the tools. " +
  "Your answer is the final report, and nothing comes after it: do not say what you will write next, write it now, " +
  "complete, with an entry for every unhealthy pod. " +
  "\n" +
  "Report only what the tools showed. For each unhealthy pod give the cause and the evidence for it (quote the log line or event). " +
  "If you loaded a skill for a pod, end that pod's entry with a line that starts with 'Not visible:' and repeats what the " +
  "runbook says you cannot see (for example, the memory limit and the actual usage). " +
  "\n" +
  "If the tools do not show a cause, say so instead of guessing. Be concise, and give no recommendations.";
const taskPrompt = "There is a problem with the 'shop' namespace, please check and report your findings";

const loopOptions: LoopOptions = {
  llm,
  system: systemPrompt,
  task: taskPrompt,
  tools: [listPodsTool({ context }), podLogsTool({ context }), eventsTool({ context }), loadSkillTool(skills)],
  maxSteps: 10,
};
const result: LoopResult = await runAgentLoop(loopOptions);

console.log("model answer:", result.answer);
for (const m of result.messages) {
  console.log("Message type:", m.type, "content:", m.content);

  if (m instanceof AIMessage && m.tool_calls && m.tool_calls.length > 0) {
    console.log("tool calls", m.tool_calls);
  }
}
