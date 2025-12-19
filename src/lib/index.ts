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
};

export type FetchMethod = "api" | "snmp";

function getFetchMethod(): FetchMethod {
  const method = (process.env.FETCH_METHOD || "api").toLowerCase();
  if (method === "snmp") return "snmp";
  return "api";
}

export async function getWanStatuses(): Promise<IspInterfaceStatus[]> {
  const method = getFetchMethod();

  if (method === "snmp") {
    const { default: getWanStatusesViaSNMP } = await import("./snmp-client");
    return getWanStatusesViaSNMP();
  } else {
    const { default: getWanStatusesViaAPI } = await import("./api-client");
    return getWanStatusesViaAPI();
  }
}

export default getWanStatuses;
