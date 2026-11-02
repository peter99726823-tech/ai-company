/** CEO decisions on a report (Approval Manager). Every decision is logged; some create follow-up tasks. */
import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { createTask, getTask, recordEvent, TaskInputError } from "../tasks/service";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

export const REPORT_ACTIONS = {
  APPROVED: "승인",
  REVISION: "수정 요청",
  MORE_ANALYSIS: "추가 분석",
  FORWARD: "다른 직원에게 전달",
  APPLY_TO_PROJECT: "프로젝트에 반영",
  CLOSE: "업무 종료",
} as const;
export type ReportAction = keyof typeof REPORT_ACTIONS;

export function reportDecisions(db: DB, reportId: string) {
  return db.select().from(s.approvals).where(eq(s.approvals.reportId, reportId)).orderBy(desc(s.approvals.createdAt), sql`rowid desc`).all();
}

export function actOnReport(
  db: DB,
  reportId: string,
  input: {
    action: ReportAction;
    note?: string;
    targetEmployeeId?: string;
    executionMode: "api" | "manual";
    project?: { id: string; stage?: string; nextPlan?: string };
  },
) {
  const report = db.select().from(s.reports).where(eq(s.reports.id, reportId)).get();
  if (!report) throw new TaskInputError("보고서를 찾을 수 없습니다.");
  if (!(input.action in REPORT_ACTIONS)) throw new TaskInputError("알 수 없는 결정입니다.");
  const note = input.note?.trim() ?? "";
  const task = report.taskId ? getTask(db, report.taskId) : null;
  let createdTaskId: string | null = null;

  const follow = (employeeId: string, instruction: string) =>
    createTask(db, {
      employeeId,
      instruction,
      projectId: report.projectId,
      parentTaskId: report.taskId,
      executionMode: input.executionMode,
      source: "approval",
      type: task && task.type !== "MEETING" && task.type !== "CHAT" ? task.type : "GENERAL",
    }).id;

  switch (input.action) {
    case "REVISION":
      if (!note) throw new TaskInputError("무엇을 고쳐야 하는지 적어 주세요.");
      createdTaskId = follow(report.employeeId, `[수정 요청] 아래 '이전 결과물'을 대표의 의견에 맞게 고쳐 다시 작성하세요.\n대표 의견: ${note}\n\n원래 지시: ${task?.instruction ?? report.title}`);
      break;
    case "MORE_ANALYSIS":
      if (!note) throw new TaskInputError("추가로 분석할 내용을 적어 주세요.");
      createdTaskId = follow(report.employeeId, `[추가 분석] '이전 결과물'을 바탕으로 다음을 더 분석하세요: ${note}`);
      break;
    case "FORWARD": {
      const to = input.targetEmployeeId ?? "";
      if (!EMPLOYEE_BY_ID[to]) throw new TaskInputError("전달할 직원을 고르세요.");
      const from = EMPLOYEE_BY_ID[report.employeeId]?.name ?? report.employeeId;
      createdTaskId = follow(to, `[전달] ${from}의 '이전 결과물'을 당신의 전문 분야 관점에서 검토하고 이어서 작업하세요.${note ? `\n대표 요청: ${note}` : ""}`);
      break;
    }
    case "APPLY_TO_PROJECT": {
      const p = input.project;
      if (!p?.id) throw new TaskInputError("반영할 프로젝트를 고르세요.");
      const proj = db.select().from(s.projects).where(eq(s.projects.id, p.id)).get();
      if (!proj) throw new TaskInputError("존재하지 않는 프로젝트입니다.");
      db.update(s.projects)
        .set({ stage: p.stage?.trim() || proj.stage, nextPlan: p.nextPlan?.trim() || proj.nextPlan, updatedAt: Date.now() })
        .where(eq(s.projects.id, p.id))
        .run();
      break;
    }
    default:
      break;
  }

  const label = REPORT_ACTIONS[input.action];
  db.insert(s.approvals)
    .values({ id: `apv_${randomUUID().slice(0, 8)}`, taskId: report.taskId, reportId, kind: "REPORT_REVIEW", decision: input.action, note: note || null, decidedAt: Date.now() })
    .run();
  recordEvent(db, {
    type: "DECISION_RECORDED",
    taskId: report.taskId,
    employeeId: report.employeeId,
    message: `보고서 결정: ${label}${note ? ` — ${note.slice(0, 60)}` : ""}${createdTaskId ? " · 후속 업무 등록" : ""}`,
    data: { reportId, action: input.action, createdTaskId },
  });
  return { ok: true, createdTaskId, decisions: reportDecisions(db, reportId) };
}
