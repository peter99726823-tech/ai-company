import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getMeeting } from "@/server/meetings/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = getMeeting(getDb(), id);
  return m ? NextResponse.json(m) : NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
}
