import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { createMeeting, recentMeetings } from "@/server/meetings/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ meetings: recentMeetings(getDb(), 20) });
}

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const r = createMeeting(getDb(), {
      topic: String(b.topic ?? ""),
      participantIds: Array.isArray(b.participantIds) ? b.participantIds.map(String) : [],
      projectId: b.projectId ?? null,
      executionMode: b.executionMode === "api" ? "api" : "manual",
      attachments: b.attachments,
    });
    return NextResponse.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `회의를 만들지 못했습니다: ${(e as Error).message}` }, { status: 500 });
  }
}
