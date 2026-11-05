import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { usageSummary } from "@/server/work/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(usageSummary(getDb()));
}
