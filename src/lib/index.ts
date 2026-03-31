// Unified interface for fetching WAN status
// Supports both SonicWall REST API and SNMP methods

export type IspInterfaceStatus = {
  name: string;
  linkUp: boolean | null;
  ipAddress: string | null;
  subnetMask: string | null;
  linkSpeed: string | null;
  ipMode: string | null;
  zone: string | null;
  comment: string | null;
  // SNMP-specific fields (only populated when using SNMP)
  bytesIn?: number;
  bytesOut?: number;
  errorsIn?: number;
  errorsOut?: number;
  // Failover/LB probe fields
  probeStatus?: "alive" | "unavailable" | "unknown";
  lbStatus?: string;
  mainTargetStatus?: string;
};

export type FetchMethod = "api" | "snmp";

function getFetchMethod(): FetchMethod {
  const method = (process.env.FETCH_METHOD || "api").toLowerCase();
  if (method === "snmp") return "snmp";
  return "api";
}

async function applyProbeStatus(
  statuses: IspInterfaceStatus[]
): Promise<IspInterfaceStatus[]> {
  try {
    const { default: getFailoverLbStatus } = await import(
      "./failover-lb-client"
    );
    const probeResults = await getFailoverLbStatus();

    if (!probeResults) return statuses;

    const probeMap = new Map(
      probeResults.map((p) => [p.name.toUpperCase(), p])
    );

    return statuses.map((status) => {
      const probe = probeMap.get(status.name.toUpperCase());
      if (!probe) return status;

      const updated = { ...status };
      updated.lbStatus = probe.lbStatus;
      updated.mainTargetStatus = probe.mainTargetStatus;

      if (probe.probeAlive) {
        updated.probeStatus = "alive";
      } else {
        updated.probeStatus = "unavailable";
        // Physical link is up but ISP is actually down
        updated.linkUp = false;
      }
      return updated;
    });
  } catch {
    // Probe check is optional — fall back to link-only status
    return statuses;
  }
}

export async function getWanStatuses(): Promise<IspInterfaceStatus[]> {
  const method = getFetchMethod();

  let statuses: IspInterfaceStatus[];
  if (method === "snmp") {
    const { default: getWanStatusesViaSNMP } = await import("./snmp-client");
    statuses = await getWanStatusesViaSNMP();
  } else {
    const { default: getWanStatusesViaAPI } = await import("./api-client");
    statuses = await getWanStatusesViaAPI();
  }

  // Overlay failover/LB probe status — marks ISP as down if probe target is unavailable
  statuses = await applyProbeStatus(statuses);

  return statuses;
}

export default getWanStatuses;
