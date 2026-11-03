import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { submitManualAnswer } from "@/server/meetings/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manual mode: the CEO pastes the answer they got from claude.ai. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const b = await req.json();
    const reportId = submitManualAnswer(getDb(), id, String(b.text ?? ""), b.via === "claude" ? "claude" : "manual");
    return NextResponse.json({ reportId });
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
