import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { TaskInputError } from "@/server/tasks/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
const fail = (e: unknown) => NextResponse.json({ error: (e as Error).message }, { status: e instanceof TaskInputError ? 400 : 500 });
const body = async (req: Request) => { try { return await req.json(); } catch { return {}; } };

/** The PC version restores from the command line with the app stopped (the worker holds the database open). */
export function POST() {
  return NextResponse.json({ error: "PC 버전은 앱을 끈 뒤 터미널에서 'npm run db:restore 백업파일.json'으로 복원합니다." }, { status: 409 });
}
