import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getReport } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = getReport(getDb(), id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "보고서를 찾을 수 없습니다." }, { status: 404 });
}
