import crypto from "crypto";

export type ProbeStatus = {
  name: string; // Interface name, e.g. "X1"
  probeAlive: boolean;
  lbStatus: string;
  mainTargetStatus: string;
};

function md5(str: string): string {
  return crypto.createHash("md5").update(str).digest("hex");
}

function parseDigestChallenge(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  const regex = /(\w+)=(?:"([^"]+)"|([^,\s]+))/g;
  let match;
  while ((match = regex.exec(header)) !== null) {
    params[match[1]] = match[2] || match[3];
  }
  return params;
}

function buildDigestHeader(
  method: string,
  uri: string,
  username: string,
  password: string,
  challenge: Record<string, string>,
  nc: number
): string {
  const cnonce = crypto.randomBytes(16).toString("hex");
  const ncStr = nc.toString(16).padStart(8, "0");

  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = md5(
    `${ha1}:${challenge.nonce}:${ncStr}:${cnonce}:${challenge.qop}:${ha2}`
  );

  return [
    `Digest username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `algorithm=MD5`,
    `qop=${challenge.qop}`,
    `nc=${ncStr}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
    challenge.opaque ? `opaque="${challenge.opaque}"` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

function isProbeAlive(mainTargetStatus: unknown): boolean {
  if (typeof mainTargetStatus !== "string") return true;
  const s = mainTargetStatus.toLowerCase();
  if (s.includes("unavailable")) return false;
  // "Disabled" means no probe configured — don't override link status
  if (s.includes("disabled")) return true;
  // "Target Alive" or "Default Target Alive"
  if (s.includes("alive")) return true;
  // Unknown — treat as alive to avoid false negatives
  return true;
}

type FlbMember = {
  group_name: string;
  member_name: string;
  link_status: string;
  lb_status: string;
  probe_status: string;
  main_target_status: string;
  alternate_target_status: string;
};

export default async function getFailoverLbStatus(): Promise<
  ProbeStatus[] | null
> {
  const baseUrl = process.env.SONICWALL_BASE_URL?.replace(/\/+$/, "");
  const username = process.env.SONICWALL_USERNAME;
  const password = process.env.SONICWALL_PASSWORD;

  if (!baseUrl || !username || !password) return null;

  if ((process.env.SONICWALL_PROBE_CHECK ?? "true").toLowerCase() === "false") {
    return null;
  }

  const insecureTls =
    (process.env.SONICWALL_INSECURE_TLS ?? "false") === "true";
  const originalTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const authUrl = `${baseUrl}/api/sonicos/auth`;
    const authUri = "/api/sonicos/auth";

    // Step 1: Get digest challenge
    const challengeResponse = await fetch(authUrl, { method: "POST" });

    const authHeaders: string[] = [];
    challengeResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "www-authenticate") {
        authHeaders.push(value);
      }
    });

    const wwwAuth =
      authHeaders.find((h) => h.includes("algorithm=MD5")) || authHeaders[0];
    if (!wwwAuth || !wwwAuth.toLowerCase().includes("digest")) return null;

    const challenge = parseDigestChallenge(wwwAuth);

    // Step 2: Authenticate
    const authHeader = buildDigestHeader(
      "POST",
      authUri,
      username,
      password,
      challenge,
      1
    );
    const authResponse = await fetch(authUrl, {
      method: "POST",
      headers: { Authorization: authHeader },
    });

    if (!authResponse.ok) return null;

    // Step 3: Get failover/LB member status
    const statusUri = "/api/sonicos/reporting/failover-lb/status/members";
    const statusUrl = `${baseUrl}${statusUri}`;
    const statusHeader = buildDigestHeader(
      "GET",
      statusUri,
      username,
      password,
      challenge,
      2
    );

    const response = await fetch(statusUrl, {
      headers: { Authorization: statusHeader },
    });

    if (!response.ok) return null;

    const json = await response.json();
    const allMembers: FlbMember[] = Array.isArray(json) ? json : [];

    // Filter to the primary LB group (skip IPv6 group which has unreliable fields)
    const lbGroup =
      process.env.SONICWALL_LB_GROUP || " Default LB Group";
    const members = allMembers.filter(
      (m) =>
        typeof m.member_name === "string" &&
        typeof m.lb_status === "string" &&
        m.group_name?.trim() === lbGroup.trim()
    );

    return members.map((m) => ({
        name: m.member_name.trim().toUpperCase(),
        probeAlive: isProbeAlive(m.main_target_status),
        lbStatus: m.lb_status.trim(),
        mainTargetStatus:
          typeof m.main_target_status === "string"
            ? m.main_target_status.trim()
            : "Unknown",
      }));
  } catch {
    return null;
  } finally {
    if (originalTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTls;
    }
  }
}
