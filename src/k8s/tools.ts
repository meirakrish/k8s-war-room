import { type StructuredToolInterface, tool } from "@langchain/core/tools";
import { z } from "zod";
import { kubectl } from "./kubectl.ts";
import { summarizePods } from "./pods.ts";

/**
 * What the model may send as a namespace: a valid Kubernetes name (lowercase letters, digits, '-'; starts and ends
 * with a letter or digit; at most 63 characters).
 */
export const namespaceSchema = z
  .string()
  .describe("The Kubernetes cluster namespace to get pods from")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Only low case letters, numbers, and dashes allowed")
  .max(63, "Must be at most 63 characters");

/**
 * What the model may send as a pod name. Pod names follow the Kubernetes "DNS subdomain" rules: lowercase letters,
 * digits, '-' and '.'; every dot-separated part starts and ends with a letter or digit; at most 253 characters.
 * TODO: this accepts anything for now.
 */
export const podNameSchema = z
  .string()
  .describe("The Kubernetes cluster pod name to get logs from")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/,
    "Only low case letters, numbers,dashes and dots are allowed",
  )
  .min(1, "Must not be empty")
  .max(253, "Must be at most 253 characters");

export const listPodToolSchema = z.object({ namespace: namespaceSchema });

/**
 * The `list_pods` tool: what the model calls to see which pods are unhealthy.
 *
 * What happens when the model calls it:
 *   1. The model sends a namespace.
 *   2. The input is checked: only a valid Kubernetes name is accepted.
 *   3. kubectl runs `get pods` in that namespace, as JSON.
 *   4. The JSON is summarized down to the few facts that matter.
 *   5. The summary is returned to the model as text.
 *
 * The tool needs a name, a description (the model reads it), and an input schema (the namespace).
 * It receives the kubectl context when it is created, because kubectl always needs one.
 */
export const listPodsTool = (_opts: { context: string }): StructuredToolInterface =>
  tool(
    async ({ namespace }: { namespace: string }) => {
      const jsonStr: string = await kubectl(["get", "pods", "-n", namespace, "-o", "json"], _opts);
      const jsonObj = JSON.parse(jsonStr);
      const jsonRes = summarizePods(jsonObj);
      return JSON.stringify(jsonRes);
    },
    {
      name: "list_pods",
      description: "Gets the list of pods for a given Kubernetes namespace",
      schema: listPodToolSchema,
    },
  );
