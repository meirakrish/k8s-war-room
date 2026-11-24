import { type StructuredToolInterface, tool } from "@langchain/core/tools";
import { z } from "zod";
import { kubectl } from "./kubectl.ts";
import { summarizePods } from "./pods.ts";
import { truncateMiddle } from "@meirakrish/llm-kit";
import { summarizeEvents } from "./events.ts";

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
      description:
        "Lists the pods in a namespace with their phase, how many containers are ready, and each container's state, " +
        "reason, exit code, restart count, and the reason its previous run ended. " +
        "Call this first, to see which pods are unhealthy. It shows what is wrong, not always why.",
      schema: listPodToolSchema,
    },
  );

const MAX_LOGS_LINES = 100;
const MAX_LOGS_SIZE = 1000;
const MAX_EVENTS = 50;

export const podLogsToolSchema = z.object({
  namespace: namespaceSchema,
  pod: podNameSchema,
  previous: z.boolean().optional().describe("Get the previous pod logs"),
});
export const podLogsTool = (_opts: { context: string }): StructuredToolInterface =>
  tool(
    async ({ namespace, pod, previous }: { namespace: string; pod: string; previous?: boolean }) => {
      const args = previous
        ? ["logs", pod, "-n", namespace, `--tail=${MAX_LOGS_LINES}`, "--previous"]
        : ["logs", pod, "-n", namespace, `--tail=${MAX_LOGS_LINES}`];

      const str = await kubectl(args, _opts);
      return truncateMiddle(str, MAX_LOGS_SIZE);
    },
    {
      name: "pod_logs",
      description:
        `Reads the last ${MAX_LOGS_LINES} lines of a pod's logs, cut to about ${MAX_LOGS_SIZE} characters (start and end are kept). ` +
        "Use it after list_pods shows a failing pod, to find out why. " +
        "Set previous to true for a pod that keeps restarting (CrashLoopBackOff): the current container has just started " +
        "and printed little, and the error is in the previous run.",
      schema: podLogsToolSchema,
    },
  );

/**
 * The `get_events` tool: the cluster's own notes about what happened to a namespace, or to one pod.
 * Inputs: a namespace, and optionally a pod name.
 */
export const eventsToolSchema = z.object({
  namespace: namespaceSchema,
  pod: podNameSchema.optional(),
});

export const eventsTool = (_opts: { context: string }): StructuredToolInterface =>
  tool(
    async ({ namespace, pod }: { namespace: string; pod?: string }) => {
      const args = pod
        ? ["events", "--for", `pod/${pod}`, "-n", namespace, "-o", "json"]
        : ["events", "-n", namespace, "-o", "json"];

      const jsonStr: string = await kubectl(args, _opts);
      const jsonObj = JSON.parse(jsonStr);
      const jsonRes = summarizeEvents(jsonObj);

      return JSON.stringify(jsonRes);
    },
    {
      name: "get_events",
      description:
        `Reads the last ${MAX_EVENTS} events (what the cluster itself recorded) for a namespace, or for one pod if you give its name. ` +
        "Each event has a type (Normal or Warning), a reason, the object it is about, a message, a count and when it last happened. " +
        "Use it for a pod that never started or never became ready (Pending, ImagePullBackOff, scheduling or probe failures): " +
        "such a pod has no logs, and its events say why.",
      schema: eventsToolSchema,
    },
  );
