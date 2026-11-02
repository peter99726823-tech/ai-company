import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/settings";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WorkerBeat {
  at: number;
  running: number;
  keyConfigured?: boolean;
  model?: string;
  webSearch?: boolean;
  fallbacks?: boolean;
  stopped?: boolean;
}
interface AiLast {
  ok: boolean;
  at: number;
  model: string;
  error?: string;
}

/**
 * Connection status for the top bar. Never returns the API key.
 * - engineConnected: the worker wrote a heartbeat in the last 15 s
 * - verified: the most recent real Claude call succeeded
 */
export function GET() {
  const db = getDb();
  let dbOk = false;
  let dbError: string | null = null;
  try {
    db.run(sql`select 1`);
    dbOk = true;
  } catch (e) {
    dbError = (e as Error).message;
  }
  const w = getSetting<WorkerBeat>(db, "worker");
  const alive = !!w && !w.stopped && Date.now() - w.at < 15000;
  const last = getSetting<AiLast>(db, "ai_last");
  // The worker is the process that calls the API, so its view of the key is the one that matters.
  const keyConfigured = alive ? !!w!.keyConfigured : Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  const model = (alive && w!.model) || process.env.AI_MODEL || "claude-opus-5-5";

  let message: string;
  if (!alive) message = "업무 실행기(워커)가 꺼져 있습니다. 'npm run dev'로 웹과 실행기를 함께 켜세요. 지시한 업무는 실행기가 켜질 때까지 대기합니다.";
  else if (!keyConfigured) message = "실행기는 켜져 있지만 ANTHROPIC_API_KEY가 없습니다. 업무를 지시하면 실패로 기록됩니다.";
  else if (!last) message = "API 키가 설정되어 있습니다. 첫 업무를 실행하면 실제 연결을 확인합니다.";
  else if (last.ok) message = `마지막 Claude 호출 성공 (${new Date(last.at).toLocaleString("ko-KR")})`;
  else message = `마지막 Claude 호출 실패: ${last.error}`;

  return NextResponse.json({
    db: { ok: dbOk, error: dbError },
    ai: {
      keyConfigured,
      model,
      webSearch: alive ? !!w!.webSearch : false,
      verified: !!last?.ok,
      lastError: last && !last.ok ? last.error : null,
      engineConnected: alive,
      message,
    },
    worker: { running: alive, activeTasks: alive ? w!.running : 0, message: alive ? "실행기 작동 중" : "실행기 꺼짐" },
  });
}
