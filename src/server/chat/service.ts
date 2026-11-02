/** 1:1 chat with an employee. Each reply is produced by a CHAT task (API or paste mode). */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull, inArray } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { createTask, TaskInputError } from "../tasks/service";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

function conversationFor(db: DB, employeeId: string, projectId: string | null, create: boolean) {
  const where = and(eq(s.conversations.employeeId, employeeId), projectId ? eq(s.conversations.projectId, projectId) : isNull(s.conversations.projectId));
  const found = db.select().from(s.conversations).where(where).orderBy(desc(s.conversations.createdAt)).get();
  if (found || !create) return found ?? null;
  const id = `conv_${randomUUID().slice(0, 8)}`;
  db.insert(s.conversations).values({ id, employeeId, projectId, title: null }).run();
  return db.select().from(s.conversations).where(eq(s.conversations.id, id)).get()!;
}

export function getChat(db: DB, employeeId: string, projectId: string | null) {
  if (!EMPLOYEE_BY_ID[employeeId]) throw new TaskInputError("존재하지 않는 직원입니다.");
  const conv = conversationFor(db, employeeId, projectId, false);
  const messages = conv ? db.select().from(s.messages).where(eq(s.messages.conversationId, conv.id)).orderBy(asc(s.messages.createdAt)).all() : [];
  const pending = conv
    ? (db
        .select()
        .from(s.tasks)
        .where(and(eq(s.tasks.conversationId, conv.id), inArray(s.tasks.status, ["QUEUED", "PLANNING", "RUNNING"])))
        .orderBy(desc(s.tasks.createdAt))
        .get() ?? null)
    : null;
  const failed = conv
    ? (db.select().from(s.tasks).where(and(eq(s.tasks.conversationId, conv.id), eq(s.tasks.status, "FAILED"))).orderBy(desc(s.tasks.createdAt)).get() ?? null)
    : null;
  return { conversation: conv, messages, pending, failed: failed && (!messages.length || failed.createdAt > messages[messages.length - 1].createdAt) ? failed : null };
}

export function sendChat(db: DB, input: { employeeId: string; projectId?: string | null; text: string; executionMode: "api" | "manual" }) {
  const text = input.text?.trim();
  if (!text) throw new TaskInputError("메시지를 입력하세요.");
  if (text.length > 8000) throw new TaskInputError("메시지가 너무 깁니다 (최대 8,000자).");
  const projectId = input.projectId || null;
  const current = getChat(db, input.employeeId, projectId);
  if (current.pending) throw new TaskInputError("이전 메시지에 대한 답변을 먼저 받아 주세요.");
  const conv = conversationFor(db, input.employeeId, projectId, true)!;
  db.insert(s.messages).values({ id: `msg_${randomUUID().slice(0, 8)}`, conversationId: conv.id, role: "ceo", content: text }).run();
  createTask(db, {
    employeeId: input.employeeId,
    instruction: text,
    type: "CHAT",
    projectId,
    conversationId: conv.id,
    executionMode: input.executionMode,
    source: "chat",
  });
  return getChat(db, input.employeeId, projectId);
}
