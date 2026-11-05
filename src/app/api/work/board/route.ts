import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { workBoard } from "@/server/work/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(workBoard(getDb()));
}
