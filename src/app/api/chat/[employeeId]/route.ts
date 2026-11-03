import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getChat, sendChat } from "@/server/chat/service";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  const projectId = new URL(req.url).searchParams.get("projectId") || null;
  try {
    return NextResponse.json(getChat(getDb(), employeeId, projectId));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  try {
    const b = await req.json();
    return NextResponse.json(
      sendChat(getDb(), { employeeId, projectId: b.projectId ?? null, text: String(b.text ?? ""), executionMode: b.executionMode === "api" ? "api" : "manual", attachments: b.attachments }),
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
  }
}
