import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getManualPrompt } from "@/server/meetings/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json({ prompt: getManualPrompt(getDb(), id) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 404 : 500 });
  }
}
