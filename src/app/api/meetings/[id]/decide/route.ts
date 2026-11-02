import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { decideMeeting } from "@/server/meetings/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    const r = decideMeeting(getDb(), id, {
      option: String(b.option ?? ""),
      note: b.note ? String(b.note) : "",
      followUps: Array.isArray(b.followUps) ? b.followUps.map((f: { employeeId: unknown; instruction: unknown }) => ({ employeeId: String(f.employeeId), instruction: String(f.instruction) })) : [],
      executionMode: b.executionMode === "api" ? "api" : "manual",
    });
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
