import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connection status for the top bar. The API key is never returned — only whether one is set.
 * "verified" stays false until PHASE 2 makes a real call and records the result.
 */
export function GET() {
  let dbOk = false;
  let dbError: string | null = null;
  try {
    getDb().run(sql`select 1`);
    dbOk = true;
  } catch (e) {
    dbError = (e as Error).message;
  }
  const keyConfigured = Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  return NextResponse.json({
    db: { ok: dbOk, error: dbError },
    ai: {
      keyConfigured,
      model: process.env.AI_MODEL || "claude-opus-5-5",
      verified: false,
      engineConnected: false, // PHASE 2: AI Agent Engine + worker
      message: keyConfigured ? "API 키가 설정되어 있습니다. 실제 호출 검증은 PHASE 2에서 연결됩니다." : "ANTHROPIC_API_KEY가 설정되지 않았습니다.",
    },
    worker: { running: false, message: "업무 실행기는 PHASE 2에서 연결됩니다." },
  });
}
