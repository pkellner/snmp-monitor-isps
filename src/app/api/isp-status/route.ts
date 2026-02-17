import { NextResponse } from "next/server";
import { getTrackedStatuses } from "@/lib/isp-tracker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const { statuses, tracker, ispNames } = await getTrackedStatuses();
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      statuses,
      serverStartedAt: tracker.serverStartedAt,
      ispStates: tracker.ispStates,
      eventLog: tracker.eventLog,
      ispNames,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
