import { getWanStatuses, type IspInterfaceStatus } from "@/lib";

export type IspState = {
  linkUp: boolean | null;
  lastChangeTime: string; // ISO string
};

export type LogEntry = {
  id: number;
  interfaceName: string;
  event: "up" | "down";
  timestamp: string; // ISO string
  duration?: number; // ms in previous state
};

export type TrackerSnapshot = {
  serverStartedAt: string;
  ispStates: Record<string, IspState>;
  eventLog: LogEntry[];
};

// Use globalThis to survive Next.js dev hot-reloads
const GLOBAL_KEY = "__isp_tracker__" as const;

type GlobalState = {
  serverStartedAt: string;
  ispStates: Record<string, IspState>;
  eventLog: LogEntry[];
  eventIdCounter: number;
};

function getState(): GlobalState {
  const g = globalThis as unknown as Record<string, GlobalState>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      serverStartedAt: new Date().toISOString(),
      ispStates: {},
      eventLog: [],
      eventIdCounter: 0,
    };
  }
  return g[GLOBAL_KEY];
}

function processStatuses(statuses: IspInterfaceStatus[]): void {
  const state = getState();
  const now = new Date();
  const nowIso = now.toISOString();

  for (const status of statuses) {
    const prev = state.ispStates[status.name];
    const currentUp = status.linkUp;

    if (!prev) {
      state.ispStates[status.name] = {
        linkUp: currentUp,
        lastChangeTime: nowIso,
      };
      if (currentUp !== null) {
        state.eventIdCounter += 1;
        state.eventLog.unshift({
          id: state.eventIdCounter,
          interfaceName: status.name,
          event: currentUp ? "up" : "down",
          timestamp: nowIso,
        });
      }
      continue;
    }

    if (prev.linkUp !== currentUp && currentUp !== null) {
      const duration = now.getTime() - new Date(prev.lastChangeTime).getTime();
      state.eventIdCounter += 1;
      state.eventLog.unshift({
        id: state.eventIdCounter,
        interfaceName: status.name,
        event: currentUp ? "up" : "down",
        timestamp: nowIso,
        duration,
      });
      state.ispStates[status.name] = {
        linkUp: currentUp,
        lastChangeTime: nowIso,
      };
    }
  }

  if (state.eventLog.length > 100) {
    state.eventLog = state.eventLog.slice(0, 100);
  }
}

export async function getTrackedStatuses(): Promise<{
  statuses: IspInterfaceStatus[];
  tracker: TrackerSnapshot;
}> {
  const statuses = await getWanStatuses();
  processStatuses(statuses);

  const state = getState();
  return {
    statuses,
    tracker: {
      serverStartedAt: state.serverStartedAt,
      ispStates: { ...state.ispStates },
      eventLog: [...state.eventLog],
    },
  };
}
