/**
 * Runs one task end to end inside the worker process.
 * QUEUED → (claim) PLANNING → RUNNING → COMPLETED | FAILED | CANCELED
 */
import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lt, or, isNull, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { transition, recordEvent } from "./service";
import { runReport, describeError, engineConfigFromEnv, type EngineConfig, type Progress } from "../ai/engine";
import { TASK_TYPE_BY_ID } from "../ai/prompts";
import { estimateCostMicros, PRICE_TABLE_VERSION } from "../ai/pricing";
import { setSetting } from "../settings";

const LEASE_MS = 60_000;

/** Claim the oldest queued task. Only one worker can win a given task (conditional UPDATE). */
export function claimNext(db: DB, owner: string) {
  const now = Date.now();
  const candidate = db
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(eq(s.tasks.status, "QUEUED"), or(isNull(s.tasks.leaseUntil), lt(s.tasks.leaseUntil, now))))
    .orderBy(s.tasks.createdAt)
    .limit(1)
    .get();
  if (!candidate) return null;
  const ok = transition(db, candidate.id, {
    from: ["QUEUED"],
    patch: { status: "PLANNING", leaseOwner: owner, leaseUntil: now + LEASE_MS, startedAt: now, progress: 5, statusMessage: "업무 내용 확인 중" },
    event: { type: "TASK_STARTED", message: "실행기가 업무를 시작했습니다. 계획 수립 중." },
  });
  return ok ? db.select().from(s.tasks).where(eq(s.tasks.id, candidate.id)).get()! : null;
}

/** Tasks left PLANNING/RUNNING by a worker that died are failed (not silently re-run, to avoid double spending). */
export function failStaleTasks(db: DB) {
  const stale = db
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(inArray(s.tasks.status, ["PLANNING", "RUNNING"]), lt(s.tasks.leaseUntil, Date.now())))
    .all();
  for (const t of stale) {
    transition(db, t.id, {
      from: ["PLANNING", "RUNNING"],
      patch: { status: "FAILED", finishedAt: Date.now(), error: "실행기가 작업 도중 중단되어 결과를 받지 못했습니다. '다시 실행'을 누르세요.", statusMessage: "실행기 중단" },
      event: { type: "TASK_FAILED", message: "실행기가 중단되어 업무가 실패 처리되었습니다." },
    });
  }
  return stale.length;
}

/** On shutdown: fail the tasks this worker was running, so they don't look alive. */
export function failOwnedTasks(db: DB, owner: string) {
  const mine = db
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(inArray(s.tasks.status, ["PLANNING", "RUNNING"]), eq(s.tasks.leaseOwner, owner)))
    .all();
  for (const t of mine) {
    transition(db, t.id, {
      from: ["PLANNING", "RUNNING"],
      patch: { status: "FAILED", finishedAt: Date.now(), error: "실행기가 종료되어 업무가 중단되었습니다. '다시 실행'을 누르세요.", statusMessage: "실행기 종료", leaseOwner: null, leaseUntil: null },
      event: { type: "TASK_FAILED", message: "실행기가 종료되어 업무가 중단되었습니다." },
    });
  }
  return mine.length;
}

export function todaySpendMicros(db: DB) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return db
    .select({ m: sql<number>`coalesce(sum(${s.apiUsage.costMicros}),0)` })
    .from(s.apiUsage)
    .where(gte(s.apiUsage.createdAt, d.getTime()))
    .get()!.m;
}

function buildUserPrompt(db: DB, task: typeof s.tasks.$inferSelect, cfg: EngineConfig) {
  const def = TASK_TYPE_BY_ID[task.type] ?? TASK_TYPE_BY_ID.GENERAL;
  const company = db.select().from(s.company).get();
  const project = task.projectId ? db.select().from(s.projects).where(eq(s.projects.id, task.projectId)).get() : null;
  const parts: string[] = [];
  parts.push(`# 회사\n${company?.name ?? ""} — ${company?.mission ?? ""}`);
  if (project) {
    parts.push(
      `# 관련 프로젝트 (대표가 입력한 정보, "미확인"은 아직 모르는 값)\n- 이름: ${project.name}\n- 설명: ${project.description}\n- 목표: ${project.goal}\n- 현재 단계: ${project.stage}\n- 다음 계획: ${project.nextPlan}`,
    );
  }
  parts.push(`# 업무 유형\n${def.label}: ${def.guide}`);
  parts.push(
    cfg.webSearch
      ? "# 도구\n웹 검색 도구를 쓸 수 있습니다. 최신 가격·경쟁사·시장 정보는 검색해서 확인하고, 참고한 자료에 실제 URL을 적으세요."
      : `# 도구\n이번 업무에서는 웹 검색을 쓸 수 없습니다. 최신 정보는 조사하지 못했다고 밝히고, '참고한 자료'에는 "웹 검색 미사용"이라고 적은 뒤 대표가 확인해야 할 항목을 쓰세요.${def.wantsWeb ? " 이 업무는 최신 시장 정보가 중요하므로 그 한계를 요약에도 밝히세요." : ""}`,
  );
  parts.push(`# 대표의 지시\n${task.instruction}`);
  return parts.join("\n\n");
}

/** Split the markdown report into the stored structured fields. */
export function parseReport(md: string) {
  const sections: Record<string, string> = {};
  let cur: string | null = null;
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line.trim());
    if (m) {
      cur = m[1].trim();
      sections[cur] = "";
    } else if (cur) sections[cur] += line + "\n";
  }
  const bullets = (k: string) =>
    (sections[k] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, ""))
      .filter((l) => l && l !== "해당 없음");
  return {
    summary: (sections["요약"] ?? "").trim(),
    facts: bullets("확인된 사실"),
    assumptions: bullets("가정과 불확실성"),
    nextTasks: bullets("다음 추천 업무"),
  };
}

const SECTION_BUBBLE: Record<string, string> = {
  요약: "요약 정리 중...",
  "수행한 작업": "작업 내용 정리 중...",
  "분석 결과": "분석 결과 작성 중...",
  "확인된 사실": "사실 확인 정리 중...",
  "가정과 불확실성": "가정 검토 중...",
  "참고한 자료": "참고 자료 정리 중...",
  결과물: "결과물 작성 중...",
  "다음 추천 업무": "다음 업무 제안 중...",
};

export async function runTask(db: DB, owner: string, task: typeof s.tasks.$inferSelect): Promise<void> {
  const cfg = engineConfigFromEnv();
  const budgetUsd = Number(process.env.AI_DAILY_BUDGET_USD ?? 5);
  const fail = (message: string) =>
    transition(db, task.id, {
      from: ["PLANNING", "RUNNING"],
      leaseOwner: owner,
      patch: { status: "FAILED", finishedAt: Date.now(), error: message, statusMessage: "실패", leaseOwner: null, leaseUntil: null },
      event: { type: "TASK_FAILED", message },
    });

  if (todaySpendMicros(db) >= budgetUsd * 1_000_000) {
    fail(`오늘 API 비용이 일일 한도(${budgetUsd}달러)에 도달해 실행하지 않았습니다. AI_DAILY_BUDGET_USD를 조정하거나 내일 다시 실행하세요.`);
    return;
  }

  const system = db
    .select({ p: s.employeePrompts.systemPrompt })
    .from(s.employeePrompts)
    .where(and(eq(s.employeePrompts.employeeId, task.employeeId), eq(s.employeePrompts.active, true)))
    .orderBy(sql`${s.employeePrompts.version} desc`)
    .get()?.p;
  if (!system) {
    fail("이 직원의 시스템 프롬프트가 DB에 없습니다.");
    return;
  }
  const user = buildUserPrompt(db, task, cfg);

  let attempt = task.attempts;
  while (attempt < task.maxCalls) {
    attempt++;
    const execId = `exec_${randomUUID().slice(0, 8)}`;
    db.insert(s.taskExecutions).values({ id: execId, taskId: task.id, attempt, status: "RUNNING", model: cfg.model }).run();
    const moved = transition(db, task.id, {
      from: ["PLANNING", "RUNNING"],
      leaseOwner: owner,
      patch: { status: "RUNNING", attempts: attempt, progress: 15, statusMessage: "AI 호출 시작", leaseUntil: Date.now() + LEASE_MS },
      event: { type: "TASK_PROGRESS", message: `Claude 호출 시작 (${attempt}/${task.maxCalls}회, 모델 ${cfg.model}${cfg.webSearch ? ", 웹 검색 사용" : ", 웹 검색 미사용"})` },
    });
    if (!moved) return; // canceled or taken over

    const ac = new AbortController();
    let lastEmit = 0;
    let lastBubble = "";
    const progress = (p: Progress) => {
      const now = Date.now();
      if (p.kind === "tool_start") {
        recordEvent(db, { type: "TASK_TOOL_STARTED", taskId: task.id, employeeId: task.employeeId, status: "RUNNING", message: "웹 검색 실행" });
        db.update(s.tasks).set({ statusMessage: "자료 검색 중...", updatedAt: now }).where(eq(s.tasks.id, task.id)).run();
        return;
      }
      if (p.kind === "tool_done") {
        recordEvent(db, { type: "TASK_TOOL_COMPLETED", taskId: task.id, employeeId: task.employeeId, status: "RUNNING", message: `웹 검색 결과 ${p.results}건 수신` });
        return;
      }
      const bubble = p.kind === "thinking" ? "생각 정리 중..." : (p.section && SECTION_BUBBLE[p.section]) || "보고서 작성 중...";
      // Progress follows received output (expected report ≈ 6,000 chars), capped below 95% until saved.
      const pct = p.kind === "writing" ? Math.min(92, 20 + Math.round((p.chars / 6000) * 72)) : 18;
      if (bubble !== lastBubble || now - lastEmit > 2500) {
        lastBubble = bubble;
        lastEmit = now;
        transition(db, task.id, {
          from: ["RUNNING"],
          leaseOwner: owner,
          patch: { progress: pct, statusMessage: bubble, leaseUntil: now + LEASE_MS },
          event: { type: "TASK_PROGRESS", message: bubble, data: { progress: pct } },
        });
      }
    };
    // Watch for a cancel request from the CEO while the stream runs.
    const watch = setInterval(() => {
      const t = db.select({ c: s.tasks.cancelRequested }).from(s.tasks).where(eq(s.tasks.id, task.id)).get();
      if (t?.c) ac.abort();
      db.update(s.tasks).set({ leaseUntil: Date.now() + LEASE_MS }).where(and(eq(s.tasks.id, task.id), eq(s.tasks.leaseOwner, owner))).run();
    }, 1000);

    try {
      const r = await runReport({ cfg, system, user, signal: ac.signal, onProgress: progress });
      clearInterval(watch);
      const cost = estimateCostMicros(r.model, r.usage, r.webSearches);
      db.insert(s.apiUsage)
        .values({
          id: `use_${randomUUID().slice(0, 8)}`,
          taskId: task.id,
          executionId: execId,
          model: r.model,
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          cacheReadTokens: r.usage.cache_read_input_tokens,
          cacheWriteTokens: r.usage.cache_creation_input_tokens,
          webSearches: r.webSearches,
          costMicros: cost.micros,
          costIsEstimate: true,
          priceTableVersion: cost.known ? PRICE_TABLE_VERSION : `${PRICE_TABLE_VERSION}:unknown-model`,
        })
        .run();
      setSetting(db, "ai_last", { ok: true, at: Date.now(), model: r.model });

      if (r.stopReason === "refusal") {
        db.update(s.taskExecutions).set({ status: "FAILED", finishedAt: Date.now(), requestId: r.requestId, error: "refusal" }).where(eq(s.taskExecutions.id, execId)).run();
        fail(`모델이 안전 정책으로 응답을 거절했습니다${r.refusalCategory ? ` (분류: ${r.refusalCategory})` : ""}. 지시 내용을 바꿔 다시 시도하세요.`);
        return;
      }
      if (!r.text.trim()) {
        db.update(s.taskExecutions).set({ status: "FAILED", finishedAt: Date.now(), requestId: r.requestId, error: "empty" }).where(eq(s.taskExecutions.id, execId)).run();
        fail(`AI가 빈 응답을 보냈습니다 (stop_reason: ${r.stopReason}).`);
        return;
      }
      db.update(s.taskExecutions).set({ status: "SUCCEEDED", finishedAt: Date.now(), requestId: r.requestId, model: r.model }).where(eq(s.taskExecutions.id, execId)).run();

      const parsed = parseReport(r.text);
      const reportId = `rep_${randomUUID().slice(0, 8)}`;
      const truncated = r.stopReason === "max_tokens";
      db.transaction((tx) => {
        tx.insert(s.reports)
          .values({
            id: reportId,
            taskId: task.id,
            employeeId: task.employeeId,
            projectId: task.projectId,
            title: task.title,
            body: truncated ? `${r.text}\n\n> ⚠️ 응답이 출력 길이 한도에 걸려 여기서 잘렸습니다.` : r.text,
            facts: JSON.stringify(parsed.facts),
            assumptions: JSON.stringify(parsed.assumptions),
            sources: JSON.stringify(r.sources),
            nextTasks: JSON.stringify(parsed.nextTasks),
          })
          .run();
      });
      transition(db, task.id, {
        from: ["RUNNING"],
        leaseOwner: owner,
        patch: {
          status: "COMPLETED",
          progress: 100,
          finishedAt: Date.now(),
          statusMessage: truncated ? "완료 (보고서 일부 잘림)" : "보고서 제출 완료",
          leaseOwner: null,
          leaseUntil: null,
        },
        event: {
          type: "TASK_COMPLETED",
          message: `보고서 제출 완료${truncated ? " (길이 한도로 일부 잘림)" : ""} · 토큰 입력 ${r.usage.input_tokens.toLocaleString()} / 출력 ${r.usage.output_tokens.toLocaleString()} · 추정 비용 $${(cost.micros / 1e6).toFixed(3)}`,
          data: { reportId },
        },
      });
      return;
    } catch (e) {
      clearInterval(watch);
      const d = describeError(e);
      db.update(s.taskExecutions).set({ status: d.aborted ? "CANCELED" : "FAILED", finishedAt: Date.now(), error: d.message }).where(eq(s.taskExecutions.id, execId)).run();
      if (!d.aborted && !d.message.startsWith("ANTHROPIC_API_KEY")) setSetting(db, "ai_last", { ok: false, at: Date.now(), model: cfg.model, error: d.message });
      if (d.aborted) {
        transition(db, task.id, {
          from: ["PLANNING", "RUNNING"],
          leaseOwner: owner,
          patch: { status: "CANCELED", finishedAt: Date.now(), statusMessage: "대표가 취소함", leaseOwner: null, leaseUntil: null },
          event: { type: "TASK_CANCELED", message: "대표 요청으로 진행 중인 AI 호출을 중단했습니다." },
        });
        return;
      }
      if (d.retryable && attempt < task.maxCalls) {
        const wait = 2000 * 2 ** (attempt - 1);
        transition(db, task.id, {
          from: ["RUNNING"],
          leaseOwner: owner,
          patch: { statusMessage: `재시도 대기 (${Math.round(wait / 1000)}초)`, leaseUntil: Date.now() + LEASE_MS + wait },
          event: { type: "TASK_PROGRESS", message: `${d.message} ${Math.round(wait / 1000)}초 후 다시 시도합니다.` },
        });
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      fail(d.retryable ? `${d.message} 최대 호출 횟수(${task.maxCalls}회)를 모두 써서 중단했습니다.` : d.message);
      return;
    }
  }
  fail(`최대 호출 횟수(${task.maxCalls}회)에 도달했습니다.`);
}
