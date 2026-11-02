import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

import { approveProposal } from "@/server/autonomy/service";
export async function POST(req: Request, { params }: P) { try { const b = await body(req); return NextResponse.json(approveProposal(getDb(), (await params).id, b.executionMode === "api" ? "api" : "manual")); } catch (e) { return fail(e); } }
