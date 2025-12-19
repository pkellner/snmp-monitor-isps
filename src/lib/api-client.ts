import crypto from "crypto";

export type IspInterfaceStatus = {
  name: string;
  linkUp: boolean | null;
  ipAddress: string | null;
  subnetMask: string | null;
  linkSpeed: string | null;
  ipMode: string | null;
  zone: string | null;
  comment: string | null;
};

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function toBool(value: unknown): boolean | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v.includes("up")) return true;
  if (v.includes("down")) return false;
  return null;
}

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

export default async function getWanStatuses(): Promise<IspInterfaceStatus[]> {
  const baseUrl = getEnv("SONICWALL_BASE_URL").replace(/\/+$/, "");
  const username = getEnv("SONICWALL_USERNAME");
  const password = getEnv("SONICWALL_PASSWORD");
  const insecureTls = (process.env.SONICWALL_INSECURE_TLS ?? "false") === "true";
  const wanted = (process.env.SONICWALL_WAN_INTERFACES ?? "X1,X2")
    .split(",")
    .map((v) => v.trim().toUpperCase());

  // Temporarily disable TLS verification for self-signed certs
  const originalTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  try {
    const authUrl = `${baseUrl}/api/sonicos/auth`;
    const authUri = "/api/sonicos/auth";

    // First request to get digest challenge
    const challengeResponse = await fetch(authUrl, { method: "POST" });

    // SonicWall returns multiple WWW-Authenticate headers (SHA-256 and MD5)
    // We need to find the MD5 one
    const authHeaders: string[] = [];
    challengeResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === "www-authenticate") {
        authHeaders.push(value);
      }
    });

    const wwwAuth = authHeaders.find((h) => h.includes("algorithm=MD5")) || authHeaders[0];
    if (!wwwAuth || !wwwAuth.toLowerCase().includes("digest")) {
      throw new Error("Expected digest authentication challenge");
    }

    const challenge = parseDigestChallenge(wwwAuth);

    // Authenticate with digest
    const authHeader = buildDigestHeader("POST", authUri, username, password, challenge, 1);

    const authResponse = await fetch(authUrl, {
      method: "POST",
      headers: { Authorization: authHeader },
    });

    if (!authResponse.ok) {
      throw new Error(`Auth failed: ${authResponse.status}`);
    }

    // Get interface status
    const statusUrl = `${baseUrl}/api/sonicos/reporting/interfaces/ipv4/status`;
    const statusUri = "/api/sonicos/reporting/interfaces/ipv4/status";
    const statusHeader = buildDigestHeader("GET", statusUri, username, password, challenge, 2);

    const response = await fetch(statusUrl, {
      headers: { Authorization: statusHeader },
    });

    const json = await response.json();
    const interfaces = (json as Record<string, unknown>)?.interfaces;
    const records: unknown[] = Array.isArray(json)
      ? json
      : Array.isArray(interfaces)
        ? interfaces
        : [];

    const results = records
      .map((record) => {
        const rec = record as Record<string, unknown>;
        const name = rec?.name ?? rec?.interface;
        if (!name || !wanted.includes(String(name).toUpperCase())) return null;

        return {
          name: String(name).toUpperCase(),
          linkUp: toBool(rec?.link_status ?? rec?.status),
          ipAddress: (rec?.ip_address ?? rec?.ip ?? null) as string | null,
          subnetMask: (rec?.subnet_mask ?? null) as string | null,
          linkSpeed: (rec?.status ?? null) as string | null,
          ipMode: (rec?.ip_mode ?? null) as string | null,
          zone: (rec?.zone ?? null) as string | null,
          comment: (rec?.comment ?? null) as string | null,
        };
      })
      .filter(Boolean) as IspInterfaceStatus[];

    // Note: Not logging out to avoid disrupting admin UI sessions
    return results;
  } finally {
    // Restore original TLS setting
    if (originalTls === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalTls;
    }
  }
}