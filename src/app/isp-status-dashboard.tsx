"use client";

import React from "react";

type IspInterfaceStatus = {
  name: string;
  linkUp: boolean | null;
  ipAddress: string | null;
  subnetMask: string | null;
  linkSpeed: string | null;
  ipMode: string | null;
  zone: string | null;
  comment: string | null;
  macAddress?: string;
  mtu?: number;
  bytesIn?: number;
  bytesOut?: number;
  packetsIn?: number;
  packetsOut?: number;
  errorsIn?: number;
  errorsOut?: number;
  lastChange?: number;
};

type ApiResponse =
  | { ok: true; fetchedAt: string; statuses: IspInterfaceStatus[] }
  | { ok: false; error: string };

type LogEntry = {
  id: string;
  isp: string;
  interfaceName: string;
  event: "up" | "down";
  timestamp: Date;
  duration?: number;
};

type IspState = {
  linkUp: boolean | null;
  lastChangeTime: Date;
};

type TrafficSample = {
  timestamp: number;
  bytesIn: number;
  bytesOut: number;
};

type TrafficHistory = Record<string, TrafficSample[]>;

const ISP_NAMES: Record<string, string> = {
  X1: process.env.NEXT_PUBLIC_ISP_NAME_X1 || "X1",
  X2: process.env.NEXT_PUBLIC_ISP_NAME_X2 || "X2",
};

function getIspName(interfaceName: string): string {
  return ISP_NAMES[interfaceName.toUpperCase()] || interfaceName;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function formatBytes(bytes: number): string {
  if (!bytes || isNaN(bytes)) return "0 B";
  if (bytes >= 1_000_000_000_000) return `${(bytes / 1_000_000_000_000).toFixed(2)} TB`;
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatBandwidth(bytesPerSec: number): string {
  if (!bytesPerSec || isNaN(bytesPerSec)) return "—";
  const bitsPerSec = bytesPerSec * 8;
  if (bitsPerSec >= 1_000_000_000) return `${(bitsPerSec / 1_000_000_000).toFixed(2)} Gbps`;
  if (bitsPerSec >= 1_000_000) return `${(bitsPerSec / 1_000_000).toFixed(1)} Mbps`;
  if (bitsPerSec >= 1_000) return `${(bitsPerSec / 1_000).toFixed(0)} Kbps`;
  return `${bitsPerSec.toFixed(0)} bps`;
}

function formatPackets(packets: number): string {
  if (!packets || isNaN(packets)) return "0";
  if (packets >= 1_000_000_000) return `${(packets / 1_000_000_000).toFixed(2)}B`;
  if (packets >= 1_000_000) return `${(packets / 1_000_000).toFixed(2)}M`;
  if (packets >= 1_000) return `${(packets / 1_000).toFixed(1)}K`;
  return `${packets}`;
}

function formatTimeticks(ticks: number): string {
  const totalSeconds = Math.floor(ticks / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function calculateBandwidth(
  history: TrafficSample[],
  windowSec: number
): { inBps: number; outBps: number } | null {
  if (history.length < 2) return null;

  const now = Date.now();
  const cutoff = now - windowSec * 1000;

  const samplesInWindow = history.filter((s) => s.timestamp >= cutoff);
  if (samplesInWindow.length < 2) return null;

  const oldest = samplesInWindow[0];
  const newest = samplesInWindow[samplesInWindow.length - 1];
  const timeDiff = (newest.timestamp - oldest.timestamp) / 1000;

  if (timeDiff < 1) return null;

  const bytesInDiff = newest.bytesIn - oldest.bytesIn;
  const bytesOutDiff = newest.bytesOut - oldest.bytesOut;

  // Protect against negative values (counter wrap or reset)
  if (bytesInDiff < 0 || bytesOutDiff < 0) return null;

  return {
    inBps: bytesInDiff / timeDiff,
    outBps: bytesOutDiff / timeDiff,
  };
}

// Calculate percentage of 1 Gbps (1000 Mbps)
function getBandwidthPercent(bytesPerSec: number, maxMbps: number = 1000): number {
  if (!bytesPerSec || isNaN(bytesPerSec)) return 0;
  const mbps = (bytesPerSec * 8) / 1_000_000;
  return Math.min(100, (mbps / maxMbps) * 100);
}

// Colors
const colors = {
  purple: "#a855f7",
  pink: "#ec4899",
  blue: "#3b82f6",
  cyan: "#06b6d4",
  green: "#22c55e",
  yellow: "#eab308",
  orange: "#f97316",
  red: "#ef4444",
};

export default function IspStatusDashboard(): React.ReactElement {
  const refreshIntervalMs = Number(process.env.NEXT_PUBLIC_REFRESH_MS ?? "5000");

  const [statuses, setStatuses] = React.useState<IspInterfaceStatus[]>([]);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = React.useState<string | null>(null);
  const [, setEventLog] = React.useState<LogEntry[]>([]);
  const [ispStates, setIspStates] = React.useState<Record<string, IspState>>({});
  const [trafficHistory, setTrafficHistory] = React.useState<TrafficHistory>({});
  const eventIdCounter = React.useRef(0);

  const updateStatesAndLog = React.useCallback(
    (newStatuses: IspInterfaceStatus[]) => {
      const now = new Date();

      setIspStates((prevStates) => {
        const nextStates = { ...prevStates };
        const newEntries: LogEntry[] = [];

        for (const status of newStatuses) {
          const prev = prevStates[status.name];
          const currentUp = status.linkUp;

          if (!prev) {
            nextStates[status.name] = {
              linkUp: currentUp,
              lastChangeTime: now,
            };
            if (currentUp !== null) {
              eventIdCounter.current += 1;
              newEntries.push({
                id: `event-${eventIdCounter.current}`,
                isp: getIspName(status.name),
                interfaceName: status.name,
                event: currentUp ? "up" : "down",
                timestamp: now,
              });
            }
            continue;
          }

          if (prev.linkUp !== currentUp && currentUp !== null) {
            const duration = now.getTime() - prev.lastChangeTime.getTime();
            eventIdCounter.current += 1;
            newEntries.push({
              id: `event-${eventIdCounter.current}`,
              isp: getIspName(status.name),
              interfaceName: status.name,
              event: currentUp ? "up" : "down",
              timestamp: now,
              duration,
            });
            nextStates[status.name] = {
              linkUp: currentUp,
              lastChangeTime: now,
            };
          }
        }

        if (newEntries.length > 0) {
          setEventLog((prev) => [...newEntries, ...prev].slice(0, 100));
        }

        return nextStates;
      });
    },
    []
  );

  const updateTrafficHistory = React.useCallback((newStatuses: IspInterfaceStatus[]) => {
    const now = Date.now();
    const cutoff = now - 70000;

    setTrafficHistory((prev) => {
      const next = { ...prev };
      for (const status of newStatuses) {
        if (status.bytesIn === undefined) continue;

        const existing = prev[status.name] || [];
        const filtered = existing.filter((s) => s.timestamp >= cutoff);

        next[status.name] = [
          ...filtered,
          {
            timestamp: now,
            bytesIn: status.bytesIn ?? 0,
            bytesOut: status.bytesOut ?? 0,
          },
        ];
      }
      return next;
    });
  }, []);

  async function load(): Promise<void> {
    try {
      const response = await fetch("/api/isp-status", { cache: "no-store" });
      const json = (await response.json()) as ApiResponse;

      if (!response.ok || !json.ok) {
        setErrorMessage(!json.ok ? json.error : "Request failed");
        return;
      }

      // Sort to put X2 (Zito) first
      const sorted = [...json.statuses].sort((a, b) => {
        if (a.name === "X2") return -1;
        if (b.name === "X2") return 1;
        return a.name.localeCompare(b.name);
      });
      setStatuses(sorted);
      setFetchedAt(json.fetchedAt);
      setErrorMessage(null);
      updateStatesAndLog(json.statuses);
      updateTrafficHistory(json.statuses);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  React.useEffect(() => {
    void load();
    const timerId = window.setInterval(() => void load(), refreshIntervalMs);
    return () => window.clearInterval(timerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshIntervalMs]);

  const currentDurations = React.useMemo(() => {
    const now = new Date();
    const result: Record<string, { state: string; duration: string }> = {};
    for (const [name, state] of Object.entries(ispStates)) {
      if (state.linkUp !== null) {
        const duration = now.getTime() - state.lastChangeTime.getTime();
        result[name] = {
          state: state.linkUp ? "up" : "down",
          duration: formatDuration(duration),
        };
      }
    }
    return result;
  }, [ispStates, fetchedAt]);

  // Calculate bandwidth over short window (based on refresh) and 60s
  const shortWindowSec = Math.max(10, Math.ceil(refreshIntervalMs / 1000) * 5); // At least 5 samples
  const bandwidthStats = React.useMemo(() => {
    const result: Record<string, { bwShort: { inBps: number; outBps: number } | null; bw60s: { inBps: number; outBps: number } | null }> = {};
    for (const [name, history] of Object.entries(trafficHistory)) {
      result[name] = {
        bwShort: calculateBandwidth(history, shortWindowSec),
        bw60s: calculateBandwidth(history, 60),
      };
    }
    return result;
  }, [trafficHistory, fetchedAt, shortWindowSec]);

  const statColors = [colors.purple, colors.cyan, colors.pink, colors.orange];

  return (
    <div style={{
      background: "linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #1e3a5f 100%)",
      color: "#f8fafc",
      fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 8px currentColor; }
          50% { box-shadow: 0 0 16px currentColor, 0 0 24px currentColor; }
        }
        @media (max-height: 200px) {
          .main-content { display: none !important; }
          .error-box { display: none !important; }
          .compact-header {
            padding: 8px !important;
            gap: 8px !important;
            height: 100vh !important;
            box-sizing: border-box !important;
            justify-content: stretch !important;
            align-items: stretch !important;
            border-bottom: none !important;
          }
          .status-badge {
            flex: 1 !important;
            padding: 12px 16px !important;
            gap: 10px !important;
            border-radius: 12px !important;
            justify-content: center !important;
            align-items: center !important;
          }
          .status-badge .status-dot { width: 14px !important; height: 14px !important; }
          .status-badge .status-name { font-size: 16px !important; }
          .status-badge .status-info { font-size: 12px !important; }
          .timestamp { display: none !important; }
        }
        @media (max-width: 500px) {
          .main-content { display: none !important; }
          .error-box { display: none !important; }
          .compact-header {
            padding: 10px !important;
            gap: 10px !important;
            flex-direction: column !important;
            height: 100vh !important;
            box-sizing: border-box !important;
            justify-content: stretch !important;
            align-items: stretch !important;
            border-bottom: none !important;
          }
          .status-badge {
            flex: 1 !important;
            padding: 12px 16px !important;
            gap: 10px !important;
            border-radius: 12px !important;
            justify-content: center !important;
            align-items: center !important;
          }
          .status-badge .status-dot { width: 16px !important; height: 16px !important; }
          .status-badge .status-name { font-size: 18px !important; }
          .status-badge .status-info { font-size: 13px !important; }
          .timestamp { display: none !important; }
        }
        @media (max-width: 840px) and (min-width: 501px) {
          .isp-cards-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>

      {/* Compact Header with Status Indicators */}
      <header className="compact-header" style={{
        padding: "12px 20px",
        background: "rgba(0, 0, 0, 0.3)",
        borderBottom: "1px solid rgba(168, 85, 247, 0.2)",
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
      }}>
        {statuses.map((status) => {
          const ispName = getIspName(status.name);
          const duration = currentDurations[status.name];
          const isUp = status.linkUp === true;
          const bw = bandwidthStats[status.name];

          // Format bandwidth with fixed width (always show same format)
          const fmtBw = (bps: number): string => {
            if (!bps || isNaN(bps)) return "  0.0 Mbps";
            const mbps = (bps * 8) / 1_000_000;
            if (mbps >= 1000) return `${mbps.toFixed(0).padStart(4)} Mbps`;
            if (mbps >= 100) return `${mbps.toFixed(0).padStart(4)} Mbps`;
            if (mbps >= 10) return `${mbps.toFixed(1).padStart(5)} Mbps`;
            return `${mbps.toFixed(1).padStart(5)} Mbps`;
          };

          return (
            <div key={status.name} className="status-badge" style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "8px 14px",
              background: isUp
                ? "linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(34, 197, 94, 0.05))"
                : "linear-gradient(135deg, rgba(239, 68, 68, 0.15), rgba(239, 68, 68, 0.05))",
              borderRadius: 12,
              border: `1px solid ${isUp ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
            }}>
              <div className="status-dot" style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: isUp ? colors.green : colors.red,
                boxShadow: isUp ? `0 0 12px ${colors.green}` : `0 0 12px ${colors.red}`,
                animation: isUp ? "none" : "pulse 1.5s infinite",
              }} />
              <div style={{ minWidth: 180 }}>
                <div className="status-name" style={{ fontWeight: 700, fontSize: 14, color: "#f8fafc" }}>{ispName}</div>
                <div className="status-info" style={{
                  fontSize: 11,
                  color: isUp ? "#86efac" : "#fca5a5",
                  fontFamily: "ui-monospace, 'SF Mono', Monaco, 'Cascadia Code', monospace",
                  whiteSpace: "pre",
                }}>
                  {isUp ? (
                    <>
                      <span style={{ display: "inline-block", width: 65 }}>Up {(duration?.duration || "").padEnd(6)}</span>
                      {bw?.bwShort && (
                        <span style={{ color: "#67e8f9" }}>
                          {fmtBw(bw.bwShort.inBps)} ↓ {fmtBw(bw.bwShort.outBps)} ↑
                        </span>
                      )}
                    </>
                  ) : (
                    <span style={{ display: "inline-block", width: 65 }}>Down</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        <div className="timestamp" style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>
          {fetchedAt && new Date(fetchedAt).toLocaleTimeString()}
        </div>
      </header>

      {errorMessage && (
        <div className="error-box" style={{
          margin: "16px 20px",
          background: "rgba(239, 68, 68, 0.15)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: 12,
          padding: "12px 16px",
          color: "#fca5a5",
        }}>
          {errorMessage}
        </div>
      )}

      <main className="main-content" style={{ padding: "20px", maxWidth: 1400, margin: "0 auto" }}>
        <div className="isp-cards-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
          gap: 20,
        }}>
          {statuses.map((status) => {
            const ispName = getIspName(status.name);
            const currentDuration = currentDurations[status.name];
            const hasTraffic = status.bytesIn !== undefined;
            const bw = bandwidthStats[status.name];
            const isUp = status.linkUp === true;

            return (
              <div key={status.name} style={{
                background: "rgba(30, 27, 75, 0.6)",
                borderRadius: 16,
                border: `2px solid ${isUp ? "rgba(34, 197, 94, 0.25)" : "rgba(239, 68, 68, 0.25)"}`,
                overflow: "hidden",
                backdropFilter: "blur(10px)",
              }}>
                {/* Card Header */}
                <div style={{
                  padding: "16px 20px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
                  background: isUp
                    ? "linear-gradient(135deg, rgba(34, 197, 94, 0.08) 0%, transparent 100%)"
                    : "linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0%, transparent 100%)",
                }}>
                  <div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: "#f8fafc" }}>{ispName}</div>
                    <div style={{ fontSize: 12, color: "#a5b4fc" }}>
                      {status.name} • {status.ipAddress || "No IP"}
                    </div>
                  </div>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 14px",
                    borderRadius: 20,
                    background: isUp ? "rgba(34, 197, 94, 0.15)" : "rgba(239, 68, 68, 0.15)",
                    border: `1px solid ${isUp ? "rgba(34, 197, 94, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                  }}>
                    <div style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: isUp ? colors.green : colors.red,
                      boxShadow: `0 0 8px ${isUp ? colors.green : colors.red}`,
                      animation: isUp ? "none" : "pulse 1.5s infinite",
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: isUp ? "#4ade80" : "#f87171" }}>
                      {isUp ? "Online" : "Offline"}
                    </span>
                  </div>
                </div>

                {/* Card Body */}
                <div style={{ padding: "16px 20px" }}>
                  {/* Quick Stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
                    <div style={{
                      background: `linear-gradient(135deg, ${statColors[0]}15, ${statColors[0]}08)`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      border: `1px solid ${statColors[0]}30`,
                    }}>
                      <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        {currentDuration?.state === "up" ? "Uptime" : "Downtime"}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", fontFamily: "monospace" }}>
                        {currentDuration?.duration || "—"}
                      </div>
                    </div>
                    <div style={{
                      background: `linear-gradient(135deg, ${statColors[1]}15, ${statColors[1]}08)`,
                      borderRadius: 10,
                      padding: "10px 12px",
                      border: `1px solid ${statColors[1]}30`,
                    }}>
                      <div style={{ fontSize: 9, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>Link Speed</div>
                      <div style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", fontFamily: "monospace" }}>{status.linkSpeed || "—"}</div>
                    </div>
                  </div>

                  {/* Bandwidth with Visual Bars */}
                  {hasTraffic && bw?.bwShort && (
                    <div style={{
                      background: "linear-gradient(135deg, rgba(6, 182, 212, 0.08), rgba(59, 130, 246, 0.04))",
                      borderRadius: 12,
                      padding: "14px",
                      border: "1px solid rgba(6, 182, 212, 0.15)",
                      marginBottom: 14,
                    }}>
                      <div style={{ fontSize: 10, color: "#67e8f9", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10, fontWeight: 600 }}>
                        Live Bandwidth ({Math.round(refreshIntervalMs / 1000)}s samples)
                      </div>

                      {/* Download Bar */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>Download</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#4ade80", fontFamily: "monospace" }}>
                            {formatBandwidth(bw.bwShort.inBps)}
                          </span>
                        </div>
                        <div style={{ height: 8, background: "rgba(0,0,0,0.3)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${getBandwidthPercent(bw.bwShort.inBps)}%`,
                            background: "linear-gradient(90deg, #22c55e, #4ade80)",
                            borderRadius: 4,
                            transition: "width 0.3s ease",
                            boxShadow: "0 0 8px rgba(34, 197, 94, 0.5)",
                          }} />
                        </div>
                      </div>

                      {/* Upload Bar */}
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                          <span style={{ fontSize: 11, color: "#94a3b8" }}>Upload</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "#60a5fa", fontFamily: "monospace" }}>
                            {formatBandwidth(bw.bwShort.outBps)}
                          </span>
                        </div>
                        <div style={{ height: 8, background: "rgba(0,0,0,0.3)", borderRadius: 4, overflow: "hidden" }}>
                          <div style={{
                            height: "100%",
                            width: `${getBandwidthPercent(bw.bwShort.outBps)}%`,
                            background: "linear-gradient(90deg, #3b82f6, #60a5fa)",
                            borderRadius: 4,
                            transition: "width 0.3s ease",
                            boxShadow: "0 0 8px rgba(59, 130, 246, 0.5)",
                          }} />
                        </div>
                      </div>

                      {/* 60s Average */}
                      {bw.bw60s && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(148, 163, 184, 0.1)" }}>
                          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>60s Average</div>
                          <div style={{ display: "flex", gap: 16, fontSize: 12, fontFamily: "monospace" }}>
                            <span style={{ color: "#4ade80" }}>↓ {formatBandwidth(bw.bw60s.inBps)}</span>
                            <span style={{ color: "#60a5fa" }}>↑ {formatBandwidth(bw.bw60s.outBps)}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Total Traffic */}
                  {hasTraffic && (
                    <div style={{
                      background: "rgba(30, 27, 75, 0.5)",
                      borderRadius: 10,
                      padding: "12px 14px",
                      border: "1px solid rgba(148, 163, 184, 0.1)",
                      marginBottom: 12,
                    }}>
                      <div style={{ fontSize: 9, color: "#a5b4fc", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, fontWeight: 600 }}>
                        Total Traffic
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span style={{ color: "#94a3b8" }}>↓ Downloaded</span>
                        <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>
                          {formatBytes(status.bytesIn ?? 0)} ({formatPackets(status.packetsIn ?? 0)} pkts)
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 4 }}>
                        <span style={{ color: "#94a3b8" }}>↑ Uploaded</span>
                        <span style={{ color: "#f1f5f9", fontFamily: "monospace" }}>
                          {formatBytes(status.bytesOut ?? 0)} ({formatPackets(status.packetsOut ?? 0)} pkts)
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Details Footer */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                    fontSize: 10,
                    padding: "10px",
                    background: "rgba(0, 0, 0, 0.2)",
                    borderRadius: 8,
                  }}>
                    <div>
                      <div style={{ color: "#64748b" }}>Subnet</div>
                      <div style={{ color: "#a5b4fc", fontFamily: "monospace", fontSize: 9 }}>{status.subnetMask || "—"}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b" }}>MAC</div>
                      <div style={{ color: "#a5b4fc", fontFamily: "monospace", fontSize: 9 }}>{status.macAddress?.slice(-8) || "—"}</div>
                    </div>
                    <div>
                      <div style={{ color: "#64748b" }}>Last Change</div>
                      <div style={{ color: "#a5b4fc", fontFamily: "monospace", fontSize: 9 }}>
                        {status.lastChange !== undefined ? formatTimeticks(status.lastChange) : "—"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

      </main>
    </div>
  );
}
