import snmp from "net-snmp";

export type IspInterfaceStatus = {
  name: string;
  linkUp: boolean | null;
  ipAddress: string | null;
  subnetMask: string | null;
  linkSpeed: string | null;
  ipMode: string | null;
  zone: string | null;
  comment: string | null;
  // SNMP-specific fields
  macAddress?: string;
  mtu?: number;
  bytesIn?: number;
  bytesOut?: number;
  packetsIn?: number;
  packetsOut?: number;
  errorsIn?: number;
  errorsOut?: number;
  lastChange?: number; // timeticks since last state change
};

export type SystemInfo = {
  name: string;
  description: string;
  uptime: number; // timeticks
  location?: string;
  contact?: string;
};

// Standard SNMP OIDs for interface monitoring
const OID = {
  // System info
  sysDescr: "1.3.6.1.2.1.1.1.0",
  sysUpTime: "1.3.6.1.2.1.1.3.0",
  sysName: "1.3.6.1.2.1.1.5.0",
  sysLocation: "1.3.6.1.2.1.1.6.0",
  sysContact: "1.3.6.1.2.1.1.4.0",
  // Interface table
  ifDescr: "1.3.6.1.2.1.2.2.1.2",
  ifOperStatus: "1.3.6.1.2.1.2.2.1.8",
  ifSpeed: "1.3.6.1.2.1.2.2.1.5",
  ifPhysAddress: "1.3.6.1.2.1.2.2.1.6",
  ifMtu: "1.3.6.1.2.1.2.2.1.4",
  ifLastChange: "1.3.6.1.2.1.2.2.1.9",
  ifInOctets: "1.3.6.1.2.1.2.2.1.10",
  ifOutOctets: "1.3.6.1.2.1.2.2.1.16",
  ifInErrors: "1.3.6.1.2.1.2.2.1.14",
  ifOutErrors: "1.3.6.1.2.1.2.2.1.20",
  ifInUcastPkts: "1.3.6.1.2.1.2.2.1.11",
  ifOutUcastPkts: "1.3.6.1.2.1.2.2.1.17",
  // 64-bit counters (ifXTable)
  ifHCInOctets: "1.3.6.1.2.1.31.1.1.1.6",
  ifHCOutOctets: "1.3.6.1.2.1.31.1.1.1.10",
  // IP address table
  ipAdEntIfIndex: "1.3.6.1.2.1.4.20.1.2",
  ipAdEntAddr: "1.3.6.1.2.1.4.20.1.1",
  ipAdEntNetMask: "1.3.6.1.2.1.4.20.1.3",
};

function getEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value || defaultValue || "";
}

function formatSpeed(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(0)} Gbps`;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(0)} Mbps`;
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(0)} Kbps`;
  return `${bps} bps`;
}

function formatMac(buffer: Buffer): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(":")
    .toUpperCase();
}

// Convert SNMP counter value to number (handles BigInt, Buffer, and regular numbers)
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (Buffer.isBuffer(value)) {
    // Convert buffer to number (big-endian)
    let result = 0;
    for (let i = 0; i < value.length; i++) {
      result = result * 256 + value[i];
    }
    return result;
  }
  return 0;
}

function snmpGet(session: snmp.Session, oids: string[]): Promise<snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    session.get(oids, (error, varbinds) => {
      if (error) {
        reject(error);
      } else {
        resolve(varbinds ?? []);
      }
    });
  });
}

function snmpWalk(session: snmp.Session, oid: string): Promise<snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    const results: snmp.Varbind[] = [];
    session.subtree(
      oid,
      (varbinds: snmp.Varbind[]) => {
        results.push(...varbinds);
      },
      (error: Error | null) => {
        if (error) {
          reject(error);
        } else {
          resolve(results);
        }
      }
    );
  });
}

export async function getSystemInfo(): Promise<SystemInfo | null> {
  const host = getEnv("SNMP_HOST", "10.10.10.1");
  const community = getEnv("SNMP_COMMUNITY", "public");

  const session = snmp.createSession(host, community, {
    timeout: 5000,
    retries: 1,
    version: snmp.Version2c,
  });

  try {
    const results = await snmpGet(session, [
      OID.sysDescr,
      OID.sysUpTime,
      OID.sysName,
      OID.sysLocation,
      OID.sysContact,
    ]);

    return {
      description: results[0]?.value?.toString() || "",
      uptime: (results[1]?.value as number) || 0,
      name: results[2]?.value?.toString() || "",
      location: results[3]?.value?.toString() || undefined,
      contact: results[4]?.value?.toString() || undefined,
    };
  } catch {
    return null;
  } finally {
    session.close();
  }
}

export default async function getWanStatusesViaSNMP(): Promise<IspInterfaceStatus[]> {
  const host = getEnv("SNMP_HOST", "10.10.10.1");
  const community = getEnv("SNMP_COMMUNITY", "public");
  const wanted = getEnv("SONICWALL_WAN_INTERFACES", "X1,X2")
    .split(",")
    .map((v) => v.trim().toUpperCase());

  const session = snmp.createSession(host, community, {
    timeout: 5000,
    retries: 1,
    version: snmp.Version2c,
  });

  try {
    // Get interface descriptions to find indices for X1, X2
    const ifDescrResults = await snmpWalk(session, OID.ifDescr);

    // Map interface name to index
    const ifIndexMap: Record<string, number> = {};
    for (const vb of ifDescrResults) {
      if (vb.value == null) continue;
      const fullName = vb.value.toString();
      const match = fullName.match(/^(X\d+)/i);
      if (match) {
        const name = match[1].toUpperCase();
        const index = parseInt(vb.oid.split(".").pop() || "0", 10);
        if (wanted.includes(name)) {
          ifIndexMap[name] = index;
        }
      }
    }

    if (Object.keys(ifIndexMap).length === 0) {
      throw new Error(`No matching interfaces found for: ${wanted.join(", ")}`);
    }

    // Get IP addresses and map to interface index
    const ipAddrResults = await snmpWalk(session, OID.ipAdEntAddr);
    const ipIndexResults = await snmpWalk(session, OID.ipAdEntIfIndex);
    const ipMaskResults = await snmpWalk(session, OID.ipAdEntNetMask);

    const ipByIfIndex: Record<number, { ip: string; mask: string }> = {};
    for (let i = 0; i < ipAddrResults.length; i++) {
      const ifIndex = ipIndexResults[i]?.value as number;
      const ip = ipAddrResults[i]?.value?.toString() || "";
      const mask = ipMaskResults[i]?.value?.toString() || "";
      if (ifIndex && ip) {
        ipByIfIndex[ifIndex] = { ip, mask };
      }
    }

    // Build OID list for all wanted interfaces
    const indices = Object.values(ifIndexMap);
    const statusOids = indices.map((i) => `${OID.ifOperStatus}.${i}`);
    const speedOids = indices.map((i) => `${OID.ifSpeed}.${i}`);
    const macOids = indices.map((i) => `${OID.ifPhysAddress}.${i}`);
    const mtuOids = indices.map((i) => `${OID.ifMtu}.${i}`);
    const lastChangeOids = indices.map((i) => `${OID.ifLastChange}.${i}`);
    const inOctetsOids = indices.map((i) => `${OID.ifHCInOctets}.${i}`);
    const outOctetsOids = indices.map((i) => `${OID.ifHCOutOctets}.${i}`);
    const inPktsOids = indices.map((i) => `${OID.ifInUcastPkts}.${i}`);
    const outPktsOids = indices.map((i) => `${OID.ifOutUcastPkts}.${i}`);
    const inErrorsOids = indices.map((i) => `${OID.ifInErrors}.${i}`);
    const outErrorsOids = indices.map((i) => `${OID.ifOutErrors}.${i}`);

    const allOids = [
      ...statusOids,
      ...speedOids,
      ...macOids,
      ...mtuOids,
      ...lastChangeOids,
      ...inOctetsOids,
      ...outOctetsOids,
      ...inPktsOids,
      ...outPktsOids,
      ...inErrorsOids,
      ...outErrorsOids,
    ];

    const results = await snmpGet(session, allOids);

    // Parse results (11 groups of data)
    const n = indices.length;
    const statusResults = results.slice(0, n);
    const speedResults = results.slice(n, n * 2);
    const macResults = results.slice(n * 2, n * 3);
    const mtuResults = results.slice(n * 3, n * 4);
    const lastChangeResults = results.slice(n * 4, n * 5);
    const inOctetsResults = results.slice(n * 5, n * 6);
    const outOctetsResults = results.slice(n * 6, n * 7);
    const inPktsResults = results.slice(n * 7, n * 8);
    const outPktsResults = results.slice(n * 8, n * 9);
    const inErrorsResults = results.slice(n * 9, n * 10);
    const outErrorsResults = results.slice(n * 10, n * 11);

    // Build status objects
    const statuses: IspInterfaceStatus[] = [];
    const names = Object.keys(ifIndexMap);

    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const ifIndex = ifIndexMap[name];
      const ipInfo = ipByIfIndex[ifIndex];

      const operStatus = statusResults[i]?.value as number;
      const speed = speedResults[i]?.value as number;
      const macBuffer = macResults[i]?.value as Buffer;
      const mtu = mtuResults[i]?.value as number;
      const lastChange = lastChangeResults[i]?.value as number;
      // Convert all counter values properly (handles Buffer, BigInt, number)
      const bytesIn = toNumber(inOctetsResults[i]?.value);
      const bytesOut = toNumber(outOctetsResults[i]?.value);
      const packetsIn = toNumber(inPktsResults[i]?.value);
      const packetsOut = toNumber(outPktsResults[i]?.value);
      const errorsIn = toNumber(inErrorsResults[i]?.value);
      const errorsOut = toNumber(outErrorsResults[i]?.value);

      statuses.push({
        name,
        linkUp: operStatus === 1 ? true : operStatus === 2 ? false : null,
        ipAddress: ipInfo?.ip || null,
        subnetMask: ipInfo?.mask || null,
        linkSpeed: speed ? formatSpeed(speed) : null,
        ipMode: null,
        zone: "WAN",
        comment: null,
        macAddress: macBuffer ? formatMac(macBuffer) : undefined,
        mtu,
        bytesIn,
        bytesOut,
        packetsIn,
        packetsOut,
        errorsIn,
        errorsOut,
        lastChange,
      });
    }

    return statuses;
  } finally {
    session.close();
  }
}
