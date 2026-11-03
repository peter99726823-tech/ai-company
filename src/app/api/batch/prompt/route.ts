import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { batchPrompt } from "@/server/tasks/batch";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One prompt for several follow-up tasks (one Claude answer or one paste). */
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const ids = Array.isArray(b.taskIds) ? b.taskIds.map(String) : [];
    return NextResponse.json({ prompt: batchPrompt(getDb(), ids) });
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
