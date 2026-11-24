// Runs the agent once and prints the transcript. Run: pnpm investigate
import { createLlmClient, resolveLlmConfig } from "@meirakrish/llm-kit";
import { runAgentLoop, type LoopOptions, type LoopResult } from "./agents/loop.ts";
import { AIMessage } from "@langchain/core/messages";
import { listPodsTool, podLogsTool, eventsTool } from "./k8s/tools.ts";

const context = "war-room";
const llmConfig = resolveLlmConfig();
const llm = await createLlmClient(llmConfig);
console.log("model", llm.model);

const systemPrompt =
  "You are a Kubernetes incident investigator. You can only read the cluster, never change it. " +
  "Work in this order: (1) list the pods to see which are unhealthy; " +
  "(2) for EVERY unhealthy pod, call a tool to find out why before you answer: read its logs if its container has run, " +
  "and read its events if it never started (Pending, image pull or scheduling problems); " +
  "(3) answer. Do not answer while an unhealthy pod still has no cause from the tools. " +
  "Report only what the tools showed. For each unhealthy pod give the cause and the evidence for it (quote the log line or event). " +
  "If the tools do not show a cause, say so instead of guessing. Be concise, and give no recommendations.";
const taskPrompt = "There is a problem with the 'shop' namespace, please check and report your findings";

const loopOptions: LoopOptions = {
  llm,
  system: systemPrompt,
  task: taskPrompt,
  tools: [listPodsTool({ context }), podLogsTool({ context }), eventsTool({ context })],
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
