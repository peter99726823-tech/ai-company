/**
 * Autonomous operation (PHASE 4).
 *  - 수동 (manual): only what the CEO orders. Routines are skipped (and logged as skipped).
 *  - 반자동 (semi): due routines and report follow-ups become PROPOSALS (WAITING_APPROVAL) the CEO approves.
 *  - 자동 (auto): due routines run on their own, up to a daily limit; anything over the limit becomes a proposal.
 * The scheduler runs in the worker (PC version, keeps going with the page closed) or in the page (link version).
 */
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { createTask, recordEvent, transition, TaskInputError, getTask } from "../tasks/service";
import { getSetting, setSetting } from "../settings";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_TYPE_BY_ID } from "@/domain/taskTypes";

export type AutonomyMode = "manual" | "semi" | "auto";
export interface Autonomy {
  mode: AutonomyMode;
  dailyAutoLimit: number;
  proposalsFromReports: boolean;
}
const DEFAULT: Autonomy = { mode: "manual", dailyAutoLimit: 5, proposalsFromReports: true };

export function getAutonomy(db: DB): Autonomy {
  return { ...DEFAULT, ...(getSetting<Partial<Autonomy>>(db, "autonomy") ?? {}) };
}

export function setAutonomy(db: DB, patch: Partial<Autonomy>): Autonomy {
  const cur = getAutonomy(db);
  const next: Autonomy = {
    mode: patch.mode && ["manual", "semi", "auto"].includes(patch.mode) ? patch.mode : cur.mode,
    dailyAutoLimit: patch.dailyAutoLimit !== undefined ? Math.max(0, Math.min(50, Math.round(Number(patch.dailyAutoLimit) || 0))) : cur.dailyAutoLimit,
    proposalsFromReports: patch.proposalsFromReports ?? cur.proposalsFromReports,
  };
  setSetting(db, "autonomy", next);
  if (next.mode !== cur.mode) {
    const label = { manual: "수동", semi: "반자동", auto: "자동" }[next.mode];
    recordEvent(db, { type: "DECISION_RECORDED", message: `운영 모드 변경: ${label}` });
  }
  return next;
}

// ─── routines ──────────────────────────────────────────────────────

export interface RoutineInput {
  employeeId: string;
  title: string;
  instruction: string;
  type?: string;
  projectId?: string | null;
  frequency: "daily" | "weekly" | "monthly";
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  hour?: number;
  executionMode?: "api" | "manual";
}

/** Next run strictly after `from`, at `hour`:00 local time. */
export function nextRunAfter(r: { frequency: string; dayOfWeek?: number | null; dayOfMonth?: number | null; hour: number }, from: number): number {
  const d = new Date(from);
  d.setMinutes(0, 0, 0);
  d.setHours(r.hour);
  for (let i = 0; i < 400; i++) {
    const ok =
      d.getTime() > from &&
      (r.frequency === "daily" || (r.frequency === "weekly" && d.getDay() === (r.dayOfWeek ?? 1)) || (r.frequency === "monthly" && d.getDate() === (r.dayOfMonth ?? 1)));
    if (ok) return d.getTime();
    d.setDate(d.getDate() + 1);
    d.setHours(r.hour, 0, 0, 0);
  }
  throw new Error("다음 실행 시각을 계산하지 못했습니다.");
}

export function listRoutines(db: DB) {
  return db.select().from(s.routines).orderBy(asc(s.routines.nextRunAt)).all();
}

export function createRoutine(db: DB, input: RoutineInput, now = Date.now()) {
  if (!EMPLOYEE_BY_ID[input.employeeId]) throw new TaskInputError("담당 직원을 고르세요.");
  if (!input.title?.trim() || !input.instruction?.trim()) throw new TaskInputError("이름과 업무 내용을 입력하세요.");
  if (!["daily", "weekly", "monthly"].includes(input.frequency)) throw new TaskInputError("반복 주기를 고르세요.");
  const type = input.type && TASK_TYPE_BY_ID[input.type]?.supported ? input.type : "GENERAL";
  const r = {
    frequency: input.frequency,
    dayOfWeek: input.frequency === "weekly" ? Math.max(0, Math.min(6, Number(input.dayOfWeek ?? 1))) : null,
    dayOfMonth: input.frequency === "monthly" ? Math.max(1, Math.min(28, Number(input.dayOfMonth ?? 1))) : null,
    hour: Math.max(0, Math.min(23, Number(input.hour ?? 9))),
  };
  const id = `rt_${randomUUID().slice(0, 8)}`;
  db.insert(s.routines)
    .values({
      id,
      employeeId: input.employeeId,
      title: input.title.trim().slice(0, 80),
      instruction: input.instruction.trim().slice(0, 8000),
      type,
      projectId: input.projectId || null,
      ...r,
      executionMode: input.executionMode === "api" ? "api" : "manual",
      nextRunAt: nextRunAfter(r, now),
    })
    .run();
  return db.select().from(s.routines).where(eq(s.routines.id, id)).get()!;
}

export function updateRoutine(db: DB, id: string, patch: { enabled?: boolean; executionMode?: "api" | "manual" }) {
  const r = db.select().from(s.routines).where(eq(s.routines.id, id)).get();
  if (!r) throw new TaskInputError("반복 업무를 찾을 수 없습니다.");
  db.update(s.routines)
    .set({
      ...(patch.enabled !== undefined ? { enabled: !!patch.enabled, nextRunAt: patch.enabled ? nextRunAfter(r, Date.now()) : r.nextRunAt } : {}),
      ...(patch.executionMode ? { executionMode: patch.executionMode === "api" ? "api" : "manual" } : {}),
    })
    .where(eq(s.routines.id, id))
    .run();
  return db.select().from(s.routines).where(eq(s.routines.id, id)).get()!;
}

export function deleteRoutine(db: DB, id: string) {
  db.delete(s.routines).where(eq(s.routines.id, id)).run();
  return { ok: true };
}

function startOfToday(now: number) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Turn one routine into work according to the current mode. Returns what happened. */
function fire(db: DB, r: typeof s.routines.$inferSelect, auto: Autonomy, now: number, apiAvailable: boolean, force: boolean) {
  const label = `[반복] ${r.title}`;
  if (auto.mode === "manual" && !force) {
    recordEvent(db, { type: "TASK_CANCELED", employeeId: r.employeeId, message: `반복 업무 '${r.title}' 건너뜀: 운영 모드가 수동입니다.` });
    return "skipped";
  }
  const autoToday = db
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(eq(s.tasks.source, "routine"), gte(s.tasks.createdAt, startOfToday(now)), inArray(s.tasks.status, ["QUEUED", "PLANNING", "RUNNING", "COMPLETED", "FAILED"])))
    .all().length;
  const runNow = force || (auto.mode === "auto" && autoToday < auto.dailyAutoLimit);
  const mode = r.executionMode === "api" && apiAvailable ? "api" : "manual";
  const t = createTask(db, { employeeId: r.employeeId, instruction: `${label}\n\n${r.instruction}`, type: r.type, projectId: r.projectId, executionMode: mode, source: "routine" });
  if (!runNow) {
    const why = auto.mode === "auto" ? `자동 실행 한도(하루 ${auto.dailyAutoLimit}건)를 넘어 제안으로 돌림` : "반자동 모드";
    transition(db, t.id, {
      from: ["QUEUED"],
      patch: { status: "WAITING_APPROVAL", statusMessage: "대표 승인 대기 (제안)" },
      event: { type: "TASK_APPROVAL_REQUESTED", message: `업무 제안: ${r.title} · ${why}` },
    });
    return "proposed";
  }
  return "queued";
}

/** Run every due routine once. Safe to call often; each routine fires at most once per due time. */
export function runScheduler(db: DB, now = Date.now(), apiAvailable = false) {
  const auto = getAutonomy(db);
  const due = db
    .select()
    .from(s.routines)
    .where(and(eq(s.routines.enabled, true), lte(s.routines.nextRunAt, now)))
    .all();
  const out: { id: string; result: string }[] = [];
  for (const r of due) {
    // Advance first so a crash can't fire the same routine twice.
    db.update(s.routines).set({ lastRunAt: now, nextRunAt: nextRunAfter(r, now) }).where(eq(s.routines.id, r.id)).run();
    out.push({ id: r.id, result: fire(db, r, auto, now, apiAvailable, false) });
  }
  return out;
}

/** "지금 한 번 실행": the CEO explicitly asks, so it runs whatever the mode. */
export function runRoutineNow(db: DB, id: string, apiAvailable = false) {
  const r = db.select().from(s.routines).where(eq(s.routines.id, id)).get();
  if (!r) throw new TaskInputError("반복 업무를 찾을 수 없습니다.");
  db.update(s.routines).set({ lastRunAt: Date.now() }).where(eq(s.routines.id, id)).run();
  return { result: fire(db, r, getAutonomy(db), Date.now(), apiAvailable, true) };
}

// ─── proposals ─────────────────────────────────────────────────────

/** 반자동/자동: turn a report's recommended next tasks into proposals (max 2). */
export function proposeFromReport(db: DB, taskId: string, nextTasks: string[]) {
  const auto = getAutonomy(db);
  if (auto.mode === "manual" || !auto.proposalsFromReports) return [];
  const parent = getTask(db, taskId);
  if (!parent || parent.type === "CHAT" || parent.type === "MEETING" || parent.source === "proposal") return [];
  const created: string[] = [];
  for (const item of nextTasks.slice(0, 2)) {
    const text = item.trim();
    if (text.length < 4) continue;
    const t = createTask(db, {
      employeeId: parent.employeeId,
      instruction: `[제안] ${text}`,
      projectId: parent.projectId,
      parentTaskId: parent.id,
      executionMode: parent.executionMode === "api" ? "api" : "manual",
      source: "proposal",
    });
    transition(db, t.id, {
      from: ["QUEUED"],
      patch: { status: "WAITING_APPROVAL", statusMessage: "대표 승인 대기 (제안)" },
      event: { type: "TASK_APPROVAL_REQUESTED", message: `${EMPLOYEE_BY_ID[parent.employeeId]?.name}의 업무 제안: ${text.slice(0, 50)}` },
    });
    created.push(t.id);
  }
  return created;
}

export function approveProposal(db: DB, id: string, executionMode: "api" | "manual") {
  const ok = transition(db, id, {
    from: ["WAITING_APPROVAL"],
    patch: { status: "QUEUED", executionMode, statusMessage: executionMode === "manual" ? "claude.ai 답변 붙여넣기 대기" : "실행 대기 중" },
    event: { type: "DECISION_RECORDED", message: "대표가 제안을 승인했습니다." },
  });
  if (!ok) throw new TaskInputError("승인 대기 중인 제안이 아닙니다.");
  return { ok: true };
}

export function rejectProposal(db: DB, id: string) {
  const ok = transition(db, id, {
    from: ["WAITING_APPROVAL"],
    patch: { status: "CANCELED", finishedAt: Date.now(), statusMessage: "대표가 거절함" },
    event: { type: "TASK_CANCELED", message: "대표가 제안을 거절했습니다." },
  });
  if (!ok) throw new TaskInputError("승인 대기 중인 제안이 아닙니다.");
  return { ok: true };
}
