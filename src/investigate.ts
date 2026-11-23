// Runs the agent once and prints the transcript. Run: pnpm investigate
import { createLlmClient, resolveLlmConfig } from "@meirakrish/llm-kit";
import { runAgentLoop, type LoopOptions, type LoopResult } from "./agents/loop.ts";
import { AIMessage } from "@langchain/core/messages";
import { listPodsTool } from "./k8s/tools.ts";

const context = "war-room";
const llmConfig = resolveLlmConfig();
const llm = await createLlmClient(llmConfig);
console.log("model", llm.model);

const systemPrompt =
  "You are a DevOps Investigator, you can only read, not write or change, use tools to find the problem, your answer should be concise, your answer should contain the cause and the evidence for it, if you cant find the cause, say so";
const taskPrompt = "There is a problem with the 'shop' namespace, please check and report your findings";

const loopOptions: LoopOptions = {
  llm,
  system: systemPrompt,
  task: taskPrompt,
  tools: [listPodsTool({ context })],
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
