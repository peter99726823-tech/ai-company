import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { createTask, TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create a task. The worker picks it up; this route never calls the AI itself. */
export async function POST(req: Request) {
  let body: { employeeId?: string; instruction?: string; type?: string; projectId?: string | null; executionMode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }
  try {
    const task = createTask(getDb(), {
      employeeId: String(body.employeeId ?? ""),
      instruction: String(body.instruction ?? ""),
      type: body.type === "MEETING" ? undefined : body.type,
      projectId: body.projectId ?? null,
      executionMode: body.executionMode === "manual" ? "manual" : "api",
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    if (e instanceof TaskInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: `업무를 저장하지 못했습니다: ${(e as Error).message}` }, { status: 500 });
  }
}
