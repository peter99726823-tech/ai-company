import { NextResponse } from "next/server";
import { getSqlite } from "@/server/db/client";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

import { toBackupJson } from "@/server/backup";
/** Full backup as JSON (the SQLite file inside). Works while the app runs. */
export function GET() {
  try {
    const bytes = new Uint8Array(getSqlite().serialize());
    return NextResponse.json(toBackupJson(bytes));
  } catch (e) { return fail(e); }
}
