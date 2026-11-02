import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

import { listTransactions, addTransaction } from "@/server/finance/service";
export function GET(req: Request) { return NextResponse.json(listTransactions(getDb(), new URL(req.url).searchParams.get("month"))); }
export async function POST(req: Request) { try { return NextResponse.json(addTransaction(getDb(), await body(req)), { status: 201 }); } catch (e) { return fail(e); } }
