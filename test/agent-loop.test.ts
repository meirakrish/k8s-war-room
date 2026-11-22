import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { scriptedLlm } from "@meirakrish/llm-kit/testing";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { describe, it, expect } from "vitest";
import { runAgentLoop } from "../src/agents/loop.ts";

// scriptedLlm plays back model replies in order, one per call. It never reads the messages it receives,
// but it records them in `llm.calls`, so a test can check what the loop sent to the model.

describe("runAgentLoop: tool failures go back to the model", () => {
  it("unknown tool: the loop answers the request with an error ToolMessage, and the next model call sees it", async () => {
    const llm = scriptedLlm({
      chat: [
        new AIMessage({ content: "", tool_calls: [{ name: "get_logs", args: {}, id: "call_1" }] }),
        new AIMessage("final answer"),
      ],
    });

    const result = await runAgentLoop({ llm, system: "system prompt", task: "task", tools: [] });
    expect(result.messages[result.messages.length - 1]!.content).toBe("final answer");
    expect(result.messages.filter((x) => x instanceof AIMessage).length).toBe(2);
    expect(result.messages.find((x) => x instanceof ToolMessage)).toMatchObject({
      tool_call_id: "call_1",
      content: expect.stringContaining("was not found"),
      status: "error",
    });

    // what the MODEL received: two calls, and the second one included the error ToolMessage
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages.find((x) => x instanceof ToolMessage)).toMatchObject({
      tool_call_id: "call_1",
      status: "error",
    });
  });

  it("tool throws: the error text goes back as an error ToolMessage instead of crashing the loop", async () => {
    // a real tool whose function always fails
    const brokenTool = tool(
      async () => {
        throw new Error("boom: cluster unreachable");
      },
      { name: "list_pods", description: "List pods", schema: z.object({ namespace: z.string() }) },
    );
    const llm = scriptedLlm({
      chat: [
        new AIMessage({ content: "", tool_calls: [{ name: "list_pods", args: { namespace: "shop" }, id: "call_1" }] }),
        new AIMessage("final answer"),
      ],
    });

    const result = await runAgentLoop({ llm, system: "system prompt", task: "task", tools: [brokenTool] });

    // the loop survived and the model got to answer
    expect(result.answer).toBe("final answer");
    // the error text reached the model, tied to the right request
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]!.messages.find((x) => x instanceof ToolMessage)).toMatchObject({
      tool_call_id: "call_1",
      status: "error",
      content: expect.stringContaining("boom: cluster unreachable"),
    });
  });
});
