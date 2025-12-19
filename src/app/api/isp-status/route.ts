import { NextResponse } from "next/server";
import { getWanStatuses } from "@/lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const statuses = await getWanStatuses();
    return NextResponse.json({
      ok: true,
      fetchedAt: new Date().toISOString(),
      statuses,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
