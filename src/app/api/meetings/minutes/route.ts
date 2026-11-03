import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { meetingMinutes } from "@/server/meetings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ minutes: meetingMinutes(getDb()) });
}
