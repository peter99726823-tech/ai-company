import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { submitBatch } from "@/server/tasks/batch";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save every follow-up report and the CEO Advisor's synthesis from one answer. */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const ids = Array.isArray(b.taskIds) ? b.taskIds.map(String) : [];
    return NextResponse.json(submitBatch(getDb(), ids, String(b.text ?? ""), b.meetingId ? String(b.meetingId) : null, b.via === "claude" ? "claude" : "manual"));
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
