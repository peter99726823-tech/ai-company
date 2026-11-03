/** 아이디어 메모함: capture ideas, then send one to a meeting or to the Business Validator. */
import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { createTask, TaskInputError } from "../tasks/service";
import { createMeeting, DEFAULT_PARTICIPANTS } from "../meetings/service";

export const IDEA_STATUS = { new: "새 아이디어", reviewing: "검토 중", active: "진행", hold: "보류", dropped: "폐기" } as const;
export type IdeaStatus = keyof typeof IDEA_STATUS;

export function listIdeas(db: DB) {
  const rows = db.select().from(s.ideas).orderBy(desc(s.ideas.createdAt)).all();
  const taskIds = rows.map((r) => r.linkedTaskId).filter(Boolean) as string[];
  const meetIds = rows.map((r) => r.linkedMeetingId).filter(Boolean) as string[];
  const tasks = taskIds.length ? db.select({ id: s.tasks.id, status: s.tasks.status }).from(s.tasks).where(inArray(s.tasks.id, taskIds)).all() : [];
  const meets = meetIds.length ? db.select({ id: s.meetings.id, status: s.meetings.status }).from(s.meetings).where(inArray(s.meetings.id, meetIds)).all() : [];
  const reports = taskIds.length ? db.select({ id: s.reports.id, taskId: s.reports.taskId }).from(s.reports).where(inArray(s.reports.taskId, taskIds)).all() : [];
  return rows.map((r) => ({
    ...r,
    taskStatus: tasks.find((t) => t.id === r.linkedTaskId)?.status ?? null,
    reportId: reports.find((x) => x.taskId === r.linkedTaskId)?.id ?? null,
    meetingStatus: meets.find((m) => m.id === r.linkedMeetingId)?.status ?? null,
  }));
}

export function createIdea(db: DB, input: { title: string; body?: string; projectId?: string | null }) {
  const title = input.title?.trim();
  if (!title) throw new TaskInputError("아이디어를 한 줄이라도 적어 주세요.");
  const id = `idea_${randomUUID().slice(0, 8)}`;
  db.insert(s.ideas).values({ id, title: title.slice(0, 200), body: (input.body ?? "").trim().slice(0, 8000), projectId: input.projectId || null }).run();
  return db.select().from(s.ideas).where(eq(s.ideas.id, id)).get()!;
}

export function updateIdea(db: DB, id: string, patch: { title?: string; body?: string; status?: string; projectId?: string | null }) {
  const cur = db.select().from(s.ideas).where(eq(s.ideas.id, id)).get();
  if (!cur) throw new TaskInputError("아이디어를 찾을 수 없습니다.");
  if (patch.status && !(patch.status in IDEA_STATUS)) throw new TaskInputError("알 수 없는 상태입니다.");
  db.update(s.ideas)
    .set({
      ...(patch.title?.trim() ? { title: patch.title.trim().slice(0, 200) } : {}),
      ...(patch.body !== undefined ? { body: patch.body.trim().slice(0, 8000) } : {}),
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.projectId !== undefined ? { projectId: patch.projectId || null } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(s.ideas.id, id))
    .run();
  return db.select().from(s.ideas).where(eq(s.ideas.id, id)).get()!;
}

export function deleteIdea(db: DB, id: string) {
  db.delete(s.ideas).where(eq(s.ideas.id, id)).run();
  return { ok: true };
}

function getIdea(db: DB, id: string) {
  const i = db.select().from(s.ideas).where(eq(s.ideas.id, id)).get();
  if (!i) throw new TaskInputError("아이디어를 찾을 수 없습니다.");
  return i;
}
const ideaText = (i: { title: string; body: string }) => (i.body ? `${i.title}\n\n${i.body}` : i.title);

/** Ask the Business Validator to check the idea (GO / PIVOT / HOLD / STOP). */
export function validateIdea(db: DB, id: string, executionMode: "api" | "manual") {
  const idea = getIdea(db, id);
  const t = createTask(db, {
    employeeId: "validator",
    type: "BUSINESS_IDEA",
    instruction: `[아이디어 검증] 대표의 아이디어 메모입니다. 사업성을 검증하고 GO / PIVOT / HOLD / STOP 중 하나를 권고해줘.\n\n${ideaText(idea)}`,
    projectId: idea.projectId,
    executionMode,
    source: "idea",
  });
  db.update(s.ideas).set({ linkedTaskId: t.id, status: "reviewing", updatedAt: Date.now() }).where(eq(s.ideas.id, id)).run();
  return { taskId: t.id };
}

/** Put the idea on the meeting table with the default departments. */
export function meetIdea(db: DB, id: string, executionMode: "api" | "manual", participantIds?: string[]) {
  const idea = getIdea(db, id);
  const m = createMeeting(db, {
    topic: `[아이디어] ${ideaText(idea)}`,
    participantIds: participantIds?.length ? participantIds : DEFAULT_PARTICIPANTS,
    projectId: idea.projectId,
    executionMode,
  });
  db.update(s.ideas).set({ linkedMeetingId: m.meeting.id, status: "reviewing", updatedAt: Date.now() }).where(eq(s.ideas.id, id)).run();
  return { meetingId: m.meeting.id, taskId: m.task?.id ?? null };
}
