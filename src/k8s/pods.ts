import { truncateMiddle } from "@meirakrish/llm-kit";

type PodState = "running" | "waiting" | "terminated";

export interface ContainerSummary {
  name: string;
  state: PodState;
  ready: boolean;
  reason?: string;
  message?: string;
  restartCount: number;
  exitCode?: number;
  lastReason?: string;
  lastExitCode?: number;
}

export interface PodSummary {
  name: string;
  phase: string;
  readyCount: number;
  totalCount: number;
  containers?: ContainerSummary[];
}

interface RawState {
  message?: string;
  reason?: string;
  exitCode?: number;
}

interface RawContainerStatus {
  name: string;
  ready: boolean;
  restartCount: number;
  state: Record<string, RawState>;
  lastState?: Record<string, RawState>;
}

interface RawPod {
  metadata: {
    name: string;
  };
  status: {
    phase: string;
    containerStatuses?: RawContainerStatus[];
  };
}

const MAX_MESSAGE_LENGTH = 500;

export const summarizePods = (podList: { items: RawPod[] }): PodSummary[] => {
  const xx = podList.items.map((x) => {
    return {
      name: x.metadata.name,
      phase: x.status.phase,
      containers: !x.status.containerStatuses
        ? undefined
        : x.status.containerStatuses.map((y) => {
            let lastReason: string | undefined;
            let lastExitCode: number | undefined;

            let entry = Object.entries(y.state)[0];
            if (!entry) throw new Error(`container ${y.name} has no state`);
            const [state, details]: [string, RawState] = entry;

            if (y.lastState) {
              let lastEntry = Object.entries(y.lastState)[0];
              if (lastEntry) {
                const [, lastDetails]: [string, RawState] = lastEntry;
                lastReason = lastDetails.reason;
                lastExitCode = lastDetails.exitCode;
              }
            }

            const cs: ContainerSummary = {
              name: y.name,
              state: state as PodState,
              ready: y.ready,
              restartCount: y.restartCount,
            };

            if (details.message) {
              cs.message = truncateMiddle(details.message, MAX_MESSAGE_LENGTH);
            }
            if (typeof details.exitCode !== "undefined") {
              cs.exitCode = details.exitCode;
            }
            if (details.reason) {
              cs.reason = details.reason;
            }

            if (lastReason) {
              cs.lastReason = lastReason;
            }

            if (typeof lastExitCode !== "undefined") {
              cs.lastExitCode = lastExitCode;
            }

            return cs;
          }),
    };
  });

  const ps: PodSummary[] = [];

  for (const yy of xx) {
    const readyCount = yy.containers ? yy.containers.filter((z) => z.ready).length : 0;
    const totalCount = yy.containers ? yy.containers.length : 0;
    ps.push({ ...yy, readyCount, totalCount });
  }

  return ps;
};
