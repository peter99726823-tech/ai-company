import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { actOnReport, type ReportAction } from "@/server/reports/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    return NextResponse.json(
      actOnReport(getDb(), id, {
        action: String(b.action) as ReportAction,
        note: b.note ? String(b.note) : "",
        targetEmployeeId: b.targetEmployeeId ? String(b.targetEmployeeId) : undefined,
        executionMode: b.executionMode === "api" ? "api" : "manual",
        project: b.project ?? undefined,
      }),
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
  }
}
