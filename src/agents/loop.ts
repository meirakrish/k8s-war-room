import { type BaseMessage, SystemMessage, HumanMessage, ToolMessage, AIMessage } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { LlmClient } from "@meirakrish/llm-kit";

const MAX_STEPS = 10;

export interface LoopOptions {
  llm: LlmClient;
  /** Who the agent is and how it should work. */
  system: string;
  /** What to do right now, e.g. "Namespace shop has failing pods. Find out why." */
  task: string;
  tools: StructuredToolInterface[];
  /** Safety limit on model calls, so a confused model cannot loop forever. */
  maxSteps?: number;
}

export interface LoopResult {
  /** The model's final answer (its last message, which has no tool calls). */
  answer: string;
  /** Every message exchanged, in order. */
  messages: BaseMessage[];
  steps: number;
}

/**
 * The agent loop: ask the model, run the tools it requests, give it the results, repeat until it answers.
 */
export async function runAgentLoop(_opts: LoopOptions): Promise<LoopResult> {
  let steps = 0;
  const messages: BaseMessage[] = [new SystemMessage(_opts.system), new HumanMessage(_opts.task)];

  const toolsDic: Record<string, StructuredToolInterface> = Object.fromEntries(
    _opts.tools.map((tool) => [tool.name, tool]),
  );

  const availableTools = _opts.tools.map((x) => x.name).join(",");

  while (true) {
    const res: AIMessage = await _opts.llm.chatWithTools(messages, _opts.tools);
    messages.push(res);
    steps++;

    // execute tools
    if (res.tool_calls && res.tool_calls.length > 0) {
      for (const [index, tc] of res.tool_calls.entries()) {
        const tcID = tc.id ?? `unknownToolID.${index}`;

        if (toolsDic[tc.name]) {
          const tool: StructuredToolInterface = toolsDic[tc.name] as StructuredToolInterface;

          try {
            const toolResult: string = await tool.invoke(tc.args);
            messages.push(new ToolMessage({ tool_call_id: tcID, name: tc.name, content: toolResult }));
          } catch (err) {
            messages.push(
              new ToolMessage({
                tool_call_id: tcID,
                name: tc.name,
                content: `Tool ${tc.name} invocation failed, error:${err}`,
                status: "error",
              }),
            );
          }
        } else {
          // tool not found
          messages.push(
            new ToolMessage({
              tool_call_id: tcID,
              name: tc.name,
              content: `Tool ${tc.name} was not found, available tools:${availableTools}`,
              status: "error",
            }),
          );
        }
      }
    } else {
      // no tool calls, return
      return {
        answer: String(res.content),
        messages,
        steps,
      };
    }

    if (steps >= (_opts.maxSteps || MAX_STEPS)) {
      // max iterations
      throw new Error("max iterations reached");
    }
  }
}
