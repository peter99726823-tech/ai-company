import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { searchReports } from "@/server/work/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  return NextResponse.json({ reports: searchReports(getDb(), { q: q.get("q") ?? "", projectId: q.get("projectId"), employeeId: q.get("employeeId") }) });
}
