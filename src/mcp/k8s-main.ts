// Entry point for k8s-mcp over stdio. Set K8S_CONTEXT to pin the cluster (e.g. "war-room").
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createKubectl } from "../k8s/kubectl.ts";
import { createK8sServer } from "./k8s-server.ts";

await createK8sServer(createKubectl({ context: process.env.K8S_CONTEXT })).connect(new StdioServerTransport());
console.error(`k8s-mcp ready (context: ${process.env.K8S_CONTEXT ?? "kubectl default"})`);
