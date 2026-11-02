import { NextResponse } from "next/server";
import { getOfficeSnapshot } from "@/server/services/office";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(getOfficeSnapshot());
  } catch (e) {
    return NextResponse.json({ error: `데이터베이스를 읽지 못했습니다: ${(e as Error).message}` }, { status: 500 });
  }
}
