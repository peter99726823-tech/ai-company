import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { requestCancel } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = requestCancel(getDb(), id);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
