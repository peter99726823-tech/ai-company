import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getTaskDetail } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = getTaskDetail(getDb(), id);
  return d ? NextResponse.json(d) : NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
}
