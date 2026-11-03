/**
 * Meetings and manual (paste) execution.
 */
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { createTask, getTask, recordEvent, TaskInputError } from "../tasks/service";
import { buildPrompts, finalizeTask, meetingParticipants, MeetingFormatError } from "../tasks/complete";
import { manualPrompt } from "./format";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { cleanAttachments, type Attachment } from "@/domain/attachments";

export const DEFAULT_PARTICIPANTS = ["ceo-advisor", "validator", "cto", "marketing", "pricing"];

export function createMeeting(
  db: DB,
  input: { topic: string; participantIds: string[]; projectId?: string | null; executionMode: "api" | "manual"; attachments?: unknown },
) {
  const topic = input.topic?.trim();
  if (!topic) throw new TaskInputError("회의 주제를 입력하세요.");
  if (topic.length > 4000) throw new TaskInputError("회의 주제가 너무 깁니다 (최대 4,000자).");
  const ids = [...new Set(input.participantIds)].filter((id) => EMPLOYEE_BY_ID[id]);
  if (ids.length < 2) throw new TaskInputError("참석자를 2명 이상 고르세요.");
  let attachments: Attachment[];
  try {
    attachments = cleanAttachments(input.attachments);
  } catch (e) {
    throw new TaskInputError((e as Error).message);
  }
  // CEO Advisor always attends and speaks last before the synthesis.
  const order = [...ids.filter((id) => id !== "ceo-advisor"), "ceo-advisor"];
  const meetingId = `meet_${randomUUID().slice(0, 8)}`;
  db.transaction((tx) => {
    tx.insert(s.meetings)
      .values({ id: meetingId, topic, projectId: input.projectId || null, status: "RUNNING", maxCalls: 1, attachments: attachments.length ? JSON.stringify(attachments) : null })
      .run();
    order.forEach((employeeId, i) => tx.insert(s.meetingParticipants).values({ id: `mp_${randomUUID().slice(0, 8)}`, meetingId, employeeId, order: i }).run());
  });
  const task = createTask(db, {
    employeeId: "ceo-advisor",
    instruction: `[회의] ${topic}`,
    type: "MEETING",
    projectId: input.projectId ?? null,
    executionMode: input.executionMode,
    meetingId,
    source: "meeting",
  });
  db.update(s.meetings).set({ taskId: task.id }).where(eq(s.meetings.id, meetingId)).run();
  recordEvent(db, {
    type: "MEETING_STARTED",
    meetingId,
    taskId: task.id,
    employeeId: "ceo-advisor",
    message: `회의 소집: ${topic.slice(0, 40)} · 참석 ${order.map((id) => EMPLOYEE_BY_ID[id].name).join(", ")}${attachments.length ? ` · 첨부 ${attachments.length}개` : ""}`,
  });
  return getMeeting(db, meetingId)!;
}

export function getMeeting(db: DB, id: string) {
  const meeting = db.select().from(s.meetings).where(eq(s.meetings.id, id)).get();
  if (!meeting) return null;
  const participants = meetingParticipants(db, id);
  const task = meeting.taskId ? getTask(db, meeting.taskId) : null;
  const report = meeting.summaryReportId ? (db.select().from(s.reports).where(eq(s.reports.id, meeting.summaryReportId)).get() ?? null) : null;
  const ids = meeting.decision ? ((JSON.parse(meeting.decision) as { followUpTaskIds?: string[] }).followUpTaskIds ?? []) : [];
  const followUps = ids.length
    ? db
        .select({ id: s.tasks.id, employeeId: s.tasks.employeeId, title: s.tasks.title, status: s.tasks.status, executionMode: s.tasks.executionMode })
        .from(s.tasks)
        .where(inArray(s.tasks.id, ids))
        .all()
        .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))
    : [];
  const reportIds = followUps.length ? db.select({ id: s.reports.id, taskId: s.reports.taskId }).from(s.reports).where(inArray(s.reports.taskId, followUps.map((f) => f.id))).all() : [];
  return { meeting, participants, task, report, followUps: followUps.map((f) => ({ ...f, reportId: reportIds.find((r) => r.taskId === f.id)?.id ?? null })) };
}

export function recentMeetings(db: DB, limit = 6) {
  const ms = db.select().from(s.meetings).orderBy(desc(s.meetings.createdAt)).limit(limit).all();
  const parts = ms.length ? db.select().from(s.meetingParticipants).where(inArray(s.meetingParticipants.meetingId, ms.map((m) => m.id))).all() : [];
  const tasks = ms.length ? db.select().from(s.tasks).where(inArray(s.tasks.id, ms.map((m) => m.taskId ?? ""))).all() : [];
  return ms.map((m) => ({
    ...m,
    task: tasks.find((t) => t.id === m.taskId) ?? null,
    participants: parts
      .filter((p) => p.meetingId === m.id)
      .sort((a, b) => a.order - b.order)
      .map((p) => ({ employeeId: p.employeeId, order: p.order, statement: p.statement })),
  }));
}

/** The exact text to paste into claude.ai for a manual task (same content the worker would send). */
export function getManualPrompt(db: DB, taskId: string) {
  const task = getTask(db, taskId);
  if (!task) throw new TaskInputError("업무를 찾을 수 없습니다.");
  const { system, user } = buildPrompts(db, task, false);
  return manualPrompt(system, user);
}

/** The CEO pasted claude.ai's answer: validate, save and complete. Bad format → 400 and nothing saved. */
export function submitManualAnswer(db: DB, taskId: string, text: string, via: "manual" | "claude" = "manual") {
  const task = getTask(db, taskId);
  if (!task) throw new TaskInputError("업무를 찾을 수 없습니다.");
  if (task.executionMode !== "manual") throw new TaskInputError("붙여넣기 방식 업무가 아닙니다.");
  if (task.status !== "QUEUED") throw new TaskInputError("이미 끝났거나 취소된 업무입니다.");
  const answer = text?.trim();
  const min = task.type === "CHAT" ? 1 : 40;
  if (!answer || answer.length < min) throw new TaskInputError("붙여넣은 답변이 너무 짧습니다. claude.ai 답변 전체를 복사해 붙여넣으세요.");
  if (answer.length > 200_000) throw new TaskInputError("답변이 너무 깁니다.");
  try {
    return finalizeTask(db, task, answer, { from: ["QUEUED"], via });
  } catch (e) {
    if (e instanceof MeetingFormatError) throw new TaskInputError(e.message);
    throw e;
  }
}

/** Record the CEO's decision and create the follow-up tasks they selected. */
export function decideMeeting(
  db: DB,
  meetingId: string,
  input: { option: string; note?: string; followUps: { employeeId: string; instruction: string }[]; executionMode: "api" | "manual" },
) {
  const m = getMeeting(db, meetingId);
  if (!m) throw new TaskInputError("회의를 찾을 수 없습니다.");
  if (m.meeting.status !== "COMPLETED") throw new TaskInputError("회의록이 나온 뒤에 결정할 수 있습니다.");
  if (m.meeting.decision) throw new TaskInputError("이미 결정을 기록한 회의입니다.");
  if (!input.option?.trim()) throw new TaskInputError("결정 선택지를 고르세요.");
  const created: string[] = [];
  db.transaction((tx) => {
    const decision = { option: input.option.trim(), note: input.note?.trim() ?? "", at: Date.now() };
    tx.update(s.meetings).set({ decision: JSON.stringify(decision) }).where(eq(s.meetings.id, meetingId)).run();
    tx.insert(s.approvals)
      .values({ id: `apv_${randomUUID().slice(0, 8)}`, taskId: m.task?.id ?? null, reportId: m.report?.id ?? null, kind: "MEETING_DECISION", decision: decision.option, note: decision.note || null, decidedAt: Date.now() })
      .run();
    recordEvent(tx as unknown as DB, { type: "DECISION_RECORDED", meetingId, taskId: m.task?.id, employeeId: "ceo-advisor", message: `대표 결정: ${decision.option}${decision.note ? ` (${decision.note})` : ""}` });
  });
  for (const f of input.followUps.slice(0, 8)) {
    if (!EMPLOYEE_BY_ID[f.employeeId] || !f.instruction?.trim()) continue;
    const t = createTask(db, {
      employeeId: f.employeeId,
      instruction: `${f.instruction.trim()}\n\n(회의 "${m.meeting.topic.slice(0, 60)}"의 후속 업무. 대표 결정: ${input.option})`,
      projectId: m.meeting.projectId,
      parentTaskId: m.task?.id ?? null,
      executionMode: input.executionMode,
      source: "meeting",
    });
    created.push(t.id);
  }
  if (created.length) {
    // Remember which tasks came from this decision so they can be run together and summarised.
    const cur = db.select({ d: s.meetings.decision }).from(s.meetings).where(eq(s.meetings.id, meetingId)).get();
    const d = cur?.d ? (JSON.parse(cur.d) as Record<string, unknown>) : {};
    db.update(s.meetings).set({ decision: JSON.stringify({ ...d, followUpTaskIds: created }) }).where(eq(s.meetings.id, meetingId)).run();
  }
  return { created };
}

/** Finished meetings for the 회의록 panel: topic, who spoke, the synthesis and the CEO's decision. */
export function meetingMinutes(db: DB, limit = 100) {
  const ms = db.select().from(s.meetings).where(eq(s.meetings.status, "COMPLETED")).orderBy(desc(s.meetings.endedAt)).limit(limit).all();
  if (!ms.length) return [];
  const parts = db.select().from(s.meetingParticipants).where(inArray(s.meetingParticipants.meetingId, ms.map((m) => m.id))).all();
  const repIds = ms.map((m) => m.summaryReportId).filter((x): x is string => !!x);
  const reps = repIds.length ? db.select({ id: s.reports.id, body: s.reports.body, nextTasks: s.reports.nextTasks }).from(s.reports).where(inArray(s.reports.id, repIds)).all() : [];
  return ms.map((m) => {
    const rep = reps.find((r) => r.id === m.summaryReportId);
    const decision = m.decision ? (JSON.parse(m.decision) as { option: string; note?: string }) : null;
    return {
      id: m.id,
      topic: m.topic,
      createdAt: m.createdAt,
      endedAt: m.endedAt,
      participants: parts
        .filter((p) => p.meetingId === m.id)
        .sort((a, b) => a.order - b.order)
        .map((p) => p.employeeId),
      summary: rep?.body ?? "",
      followUps: rep?.nextTasks ? (JSON.parse(rep.nextTasks) as unknown[]).length : 0,
      decision,
    };
  });
}
