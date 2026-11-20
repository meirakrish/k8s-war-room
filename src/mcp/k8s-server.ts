import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { KubectlDenied, type Kubectl } from "../k8s/kubectl.ts";
import { summarizeEvents, summarizePods } from "../k8s/pods.ts";
import { truncateMiddle } from "@meirakrish/llm-kit";

const TOOL_OUTPUT_MAX_CHARS = 4000;
/**
 * Input validation is a security boundary here, not just tidiness. A model (or a prompt injected through a log line)
 * controls these strings. If a "namespace" of `--all-namespaces` or `-A` reached kubectl it would be parsed as a flag.
 * A Kubernetes name is a DNS label: lowercase letters, digits and dashes, starting with a letter or digit.
 * That pattern cannot begin with `-`, so no argument can smuggle in a flag.
 */
export const k8sName = z
  .string()
  .max(63)
  .regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/, "must be a valid Kubernetes name (lowercase letters, digits, '-', '.')");

const toText = (value: string) => ({ content: [{ type: "text" as const, text: value }] });
const toJson = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const error = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });

/** Run a tool body; turn failures an agent can act on into tool errors, so the model sees them and can adapt. */
async function guarded(fn: () => Promise<unknown>, options: { raw?: boolean } = {}) {
  try {
    if (options.raw) {
      return toText((await fn()) as string);
    }

    return toJson(await fn());
  } catch (err) {
    if (err instanceof KubectlDenied) return error(err.message);
    // kubectl exits non-zero for "not found", "forbidden", etc. The stderr is exactly what the model needs to read.
    const stderr = (err as { stderr?: string }).stderr;
    return error(stderr?.trim() || (err instanceof Error ? err.message : String(err)));
  }
}

/** k8s-mcp: read-only cluster tools. Takes a `Kubectl` so tests can swap in fixtures. */
export function createK8sServer(kubectl: Kubectl): McpServer {
  const server = new McpServer({ name: "k8s-mcp", version: "0.1.0" });

  // ---- WORKED EXAMPLE: copy this shape for the next tools ------------------------------------------------------
  // 1. validate inputs with zod   2. build the kubectl args yourself   3. shrink the output   4. wrap in guarded()
  server.registerTool(
    "list_pods",
    {
      description:
        "List pods in a namespace with their phase, readiness, and each container's current state, last termination " +
        "reason and restart count. Start here to see what is unhealthy.",
      inputSchema: { namespace: k8sName.describe("Namespace, e.g. 'shop'") },
    },
    ({ namespace }) =>
      guarded(async () => summarizePods(JSON.parse(await kubectl(["get", "pods", "-n", namespace, "-o", "json"])))),
  );

  server.registerTool(
    "get_pod_logs",
    {
      description: "Get pod logs in a namespace.",
      inputSchema: {
        namespace: k8sName.describe("Namespace, e.g. 'shop'"),
        pod: k8sName.describe("Pod name, e.g. 'checkout-d6466c98c-zn5qd'"),
        previous: z.boolean().optional().describe("extract previous pod logs, true or false"),
      },
    },
    ({ namespace, pod, previous }) => {
      const args = ["logs", pod, "-n", namespace];
      if (previous) {
        args.push("--previous");
      }
      return guarded(async () => truncateMiddle(await kubectl(args), TOOL_OUTPUT_MAX_CHARS), { raw: true }).then(
        (res) => {
          // console.log('xxx:', res)

          const body = (res.content as { text: string }[])[0]!.text;
          if (
            body.includes("Error from server (BadRequest): previous terminated container") &&
            body.includes(`in pod "${pod}" not found`)
          ) {
            throw new Error("previous pod does not found");
          }
          return res;
        },
      );
    },
  );

  server.registerTool(
    "get_events",
    {
      description: "Get pod events for a pod (or all pods) in a namespace.",
      inputSchema: {
        namespace: k8sName.describe("Namespace, e.g. 'shop'"),
        pod: k8sName.optional().describe("Pod name, e.g. 'checkout-d6466c98c-zn5qd'"),
      },
    },
    ({ namespace, pod }) => {
      const args = ["events"];
      if (pod) {
        args.push("--for", `pod/${pod}`);
      }
      args.push("-n", namespace, "-o", "json");
      return guarded(async () => summarizeEvents(JSON.parse(await kubectl(args))));
    },
  );

  return server;
}
