/**
 * Task Orchestrator core (shared by the API and the worker).
 * Every status change goes through `transition`, which updates the task row and writes
 * the matching task_events row in one transaction, so the log and the state never disagree.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import type { EventType, TaskStatus } from "@/domain/types";
import { TASK_TYPE_BY_ID } from "../ai/prompts";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

export const ACTIVE_STATUSES: TaskStatus[] = ["QUEUED", "PLANNING", "RUNNING", "WAITING_APPROVAL"];
export const FINAL_STATUSES: TaskStatus[] = ["COMPLETED", "FAILED", "CANCELED"];

export function recordEvent(
  db: DB,
  e: { type: EventType; taskId?: string | null; meetingId?: string | null; employeeId?: string | null; status?: string | null; message: string; data?: unknown },
) {
  db.insert(s.taskEvents)
    .values({
      type: e.type,
      taskId: e.taskId ?? null,
      meetingId: e.meetingId ?? null,
      employeeId: e.employeeId ?? null,
      status: e.status ?? null,
      message: e.message,
      data: e.data === undefined ? null : JSON.stringify(e.data),
    })
    .run();
}

/**
 * Atomically change a task. `from` guards against races (e.g. a cancel arriving while the
 * worker finishes): the update only applies if the task is still in one of those statuses.
 * Returns false when the guard did not match (nothing written).
 */
export function transition(
  db: DB,
  taskId: string,
  opts: {
    from?: TaskStatus[];
    leaseOwner?: string;
    patch: Partial<typeof s.tasks.$inferInsert>;
    event: { type: EventType; message: string; data?: unknown };
  },
): boolean {
  return db.transaction((tx) => {
    const conds = [eq(s.tasks.id, taskId)];
    if (opts.from) conds.push(inArray(s.tasks.status, opts.from));
    if (opts.leaseOwner) conds.push(eq(s.tasks.leaseOwner, opts.leaseOwner));
    const res = tx
      .update(s.tasks)
      .set({ ...opts.patch, updatedAt: Date.now() })
      .where(and(...conds))
      .run();
    if (res.changes !== 1) return false;
    const t = tx.select({ employeeId: s.tasks.employeeId, status: s.tasks.status }).from(s.tasks).where(eq(s.tasks.id, taskId)).get()!;
    recordEvent(tx as unknown as DB, { ...opts.event, taskId, employeeId: t.employeeId, status: t.status });
    return true;
  });
}

export class TaskInputError extends Error {}

export function createTask(
  db: DB,
  input: {
    employeeId: string;
    instruction: string;
    type?: string;
    projectId?: string | null;
    parentTaskId?: string | null;
    executionMode?: "api" | "manual";
    meetingId?: string | null;
    source?: string;
  },
) {
  const instruction = input.instruction?.trim();
  if (!instruction) throw new TaskInputError("업무 내용을 입력하세요.");
  if (instruction.length > 20000) throw new TaskInputError("업무 내용이 너무 깁니다 (최대 20,000자).");
  const emp = db.select().from(s.employees).where(eq(s.employees.id, input.employeeId)).get();
  if (!emp) throw new TaskInputError("존재하지 않는 직원입니다.");
  const type = input.type === "MEETING" ? "MEETING" : input.type && TASK_TYPE_BY_ID[input.type] ? input.type : "GENERAL";
  const def = type === "MEETING" ? { label: "회의", supported: true, needs: "" } : TASK_TYPE_BY_ID[type];
  if (!def.supported) throw new TaskInputError(`아직 실행할 수 없는 업무 유형입니다. ${def.needs ?? ""}`);
  const executionMode = input.executionMode === "manual" ? "manual" : "api";
  if (input.projectId) {
    const p = db.select({ id: s.projects.id }).from(s.projects).where(eq(s.projects.id, input.projectId)).get();
    if (!p) throw new TaskInputError("존재하지 않는 프로젝트입니다.");
  }
  const id = `task_${randomUUID().slice(0, 8)}`;
  const title = instruction.split("\n")[0].slice(0, 60) + (instruction.length > 60 ? "…" : "");
  const maxCalls = Math.max(1, Math.min(10, Number(process.env.AI_MAX_CALLS_PER_TASK ?? 3)));
  db.transaction((tx) => {
    tx.insert(s.tasks)
      .values({
        id,
        title,
        instruction,
        type,
        status: "QUEUED",
        employeeId: emp.id,
        projectId: input.projectId || null,
        parentTaskId: input.parentTaskId ?? null,
        meetingId: input.meetingId ?? null,
        source: input.source ?? "manual",
        executionMode,
        maxCalls,
        statusMessage: executionMode === "manual" ? "claude.ai 답변 붙여넣기 대기" : "실행 대기 중",
      })
      .run();
    const name = EMPLOYEE_BY_ID[emp.id]?.name ?? emp.name;
    recordEvent(tx as unknown as DB, { type: "TASK_CREATED", taskId: id, employeeId: emp.id, status: "QUEUED", message: `업무 등록: ${title}` });
    recordEvent(tx as unknown as DB, {
      type: "TASK_ASSIGNED",
      taskId: id,
      employeeId: emp.id,
      status: "QUEUED",
      message: `${name}에게 배정 (${def.label}${executionMode === "manual" ? " · 붙여넣기 방식" : ""})`,
    });
  });
  return getTask(db, id)!;
}

export function getTask(db: DB, id: string) {
  return db.select().from(s.tasks).where(eq(s.tasks.id, id)).get() ?? null;
}

export function getTaskDetail(db: DB, id: string) {
  const task = getTask(db, id);
  if (!task) return null;
  const events = db.select().from(s.taskEvents).where(eq(s.taskEvents.taskId, id)).orderBy(s.taskEvents.id).all();
  const executions = db.select().from(s.taskExecutions).where(eq(s.taskExecutions.taskId, id)).orderBy(s.taskExecutions.attempt).all();
  const report = db.select().from(s.reports).where(eq(s.reports.taskId, id)).orderBy(desc(s.reports.createdAt)).get() ?? null;
  const usage = db
    .select({ micros: sql<number>`coalesce(sum(${s.apiUsage.costMicros}),0)`, input: sql<number>`coalesce(sum(${s.apiUsage.inputTokens}),0)`, output: sql<number>`coalesce(sum(${s.apiUsage.outputTokens}),0)` })
    .from(s.apiUsage)
    .where(eq(s.apiUsage.taskId, id))
    .get();
  return { task, events, executions, report, usage };
}

/** Cancel: a queued task is canceled at once; a running one is flagged and the worker aborts the stream. */
export function requestCancel(db: DB, id: string): { ok: boolean; message: string } {
  const t = getTask(db, id);
  if (!t) return { ok: false, message: "업무를 찾을 수 없습니다." };
  if (t.status === "QUEUED" || t.status === "WAITING_APPROVAL") {
    const ok = transition(db, id, {
      from: ["QUEUED", "WAITING_APPROVAL"],
      patch: { status: "CANCELED", finishedAt: Date.now(), statusMessage: "대표가 취소함" },
      event: { type: "TASK_CANCELED", message: "대표가 업무를 취소했습니다." },
    });
    return { ok, message: ok ? "취소했습니다." : "상태가 바뀌어 취소하지 못했습니다. 다시 시도하세요." };
  }
  if (t.status === "PLANNING" || t.status === "RUNNING") {
    db.update(s.tasks).set({ cancelRequested: true, statusMessage: "취소 요청됨", updatedAt: Date.now() }).where(eq(s.tasks.id, id)).run();
    return { ok: true, message: "취소를 요청했습니다. 실행기가 진행 중인 AI 호출을 중단합니다." };
  }
  return { ok: false, message: "이미 끝난 업무입니다." };
}

/** Retry a failed or canceled task: it goes back to the queue with its call counter reset. */
export function retryTask(db: DB, id: string): { ok: boolean; message: string } {
  const cur = getTask(db, id);
  const ok = transition(db, id, {
    from: ["FAILED", "CANCELED"],
    patch: {
      status: "QUEUED",
      error: null,
      attempts: 0,
      progress: 0,
      cancelRequested: false,
      finishedAt: null,
      startedAt: null,
      leaseOwner: null,
      leaseUntil: null,
      statusMessage: cur?.executionMode === "manual" ? "claude.ai 답변 붙여넣기 대기" : "다시 대기열에 넣음",
    },
    event: { type: "TASK_ASSIGNED", message: "대표가 다시 실행을 요청했습니다." },
  });
  return { ok, message: ok ? "다시 대기열에 넣었습니다." : "실패하거나 취소된 업무만 다시 실행할 수 있습니다." };
}

export function getReport(db: DB, id: string) {
  const report = db.select().from(s.reports).where(eq(s.reports.id, id)).get();
  if (!report) return null;
  const task = report.taskId ? getTask(db, report.taskId) : null;
  return { report, task };
}
