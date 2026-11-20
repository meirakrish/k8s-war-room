import { truncateMiddle } from "@meirakrish/llm-kit";

/**
 * Why summarise at all? `kubectl get pods -o json` is ~10 KB per pod, mostly noise (managed fields, UIDs, probes).
 * Whatever a tool returns goes into the model's context window, so a tool's job is to return the *few facts that
 * matter*, not everything it can. This is the main lever on both cost and answer quality.
 */
export interface ContainerSummary {
  name: string;
  image: string;
  /** What the container is doing right now. */
  state: { kind: "running" | "waiting" | "terminated"; reason?: string; message?: string; exitCode?: number };
  /** How the previous run ended. Often holds the real cause (e.g. OOMKilled) while `state` just says CrashLoopBackOff. */
  lastTerminated?: { reason?: string; exitCode?: number };
  restarts: number;
}

export interface PodSummary {
  name: string;
  phase: string;
  ready: string;
  containers: ContainerSummary[];
}

interface RawPod {
  metadata: { name: string };
  status: {
    phase: string;
    containerStatuses?: {
      name: string;
      image: string;
      ready: boolean;
      restartCount: number;
      state: Record<string, { reason?: string; message?: string; exitCode?: number }>;
      lastState?: Record<string, { reason?: string; exitCode?: number }>;
    }[];
  };
}

// {type, reason, object, message, count, lastSeen}

interface RawEvent {
  type: string;
  reason: string;
  involvedObject: { name: string; namespace: string; kind: string };
  message: string;
  count?: number;
  lastTimestamp: string | null;
}

export interface EventSummary {
  type: string;
  reason: string;
  object: { name: string; namespace: string; kind: string };
  message: string;
  count?: number;
  lastSeen: string | null;
}

export function summarizePods(list: { items: RawPod[] }): PodSummary[] {
  return list.items.map((pod) => {
    const statuses = pod.status.containerStatuses ?? [];
    return {
      name: pod.metadata.name,
      phase: pod.status.phase,
      ready: `${statuses.filter((s) => s.ready).length}/${statuses.length}`,
      containers: statuses.map((s) => {
        const [stateKind, d] = Object.entries(s.state)[0] ?? ["waiting", {}];
        const last = s.lastState?.terminated;
        return {
          name: s.name,
          image: s.image,
          state: {
            kind: stateKind as ContainerSummary["state"]["kind"],
            ...(d.reason && { reason: d.reason }),
            // Messages can be long (image pull errors repeat the full registry path); keep the head and the tail.
            ...(d.message && { message: truncateMiddle(d.message, 300) }),
            ...(d.exitCode !== undefined && { exitCode: d.exitCode }),
          },
          ...(last && { lastTerminated: { reason: last.reason, exitCode: last.exitCode } }),
          restarts: s.restartCount,
        };
      }),
    };
  });
}

export function summarizeEvents(list: { items: RawEvent[] }): EventSummary[] {
  return list.items
    .map((event) => {
      return {
        type: event.type,
        reason: event.reason,
        object: {
          kind: event.involvedObject.kind,
          name: event.involvedObject.name,
          namespace: event.involvedObject.namespace,
        },

        message: event.message,
        count: event.count,
        lastSeen: event.lastTimestamp,
      };
    })
    .sort((a, b) => Date.parse(a.lastSeen || "0") - Date.parse(b.lastSeen || "0"));
}
