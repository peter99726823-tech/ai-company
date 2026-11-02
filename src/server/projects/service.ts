/** Project management: edit fields, add projects, see everything tied to a project. */
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { TaskInputError } from "../tasks/service";

export interface ProjectPatch {
  name?: string;
  description?: string;
  goal?: string;
  stage?: string;
  nextPlan?: string;
  ownerId?: string | null;
  /** 원 단위. null = 미확인 (stored in the *_micros columns as plain KRW) */
  budgetKrw?: number | null;
  revenueKrw?: number | null;
}

const clean = (v: string | undefined, max: number) => (v === undefined ? undefined : v.trim().slice(0, max));

export function createProject(db: DB, p: ProjectPatch) {
  if (!p.name?.trim()) throw new TaskInputError("프로젝트 이름을 입력하세요.");
  const id = `prj_${randomUUID().slice(0, 8)}`;
  db.insert(s.projects).values({ id, name: p.name.trim().slice(0, 80), description: clean(p.description, 1000) ?? "", goal: clean(p.goal, 300) || "미확인", stage: clean(p.stage, 60) || "아이디어", nextPlan: clean(p.nextPlan, 500) ?? "" }).run();
  return db.select().from(s.projects).where(eq(s.projects.id, id)).get()!;
}

export function updateProject(db: DB, id: string, p: ProjectPatch) {
  const cur = db.select().from(s.projects).where(eq(s.projects.id, id)).get();
  if (!cur) throw new TaskInputError("프로젝트를 찾을 수 없습니다.");
  const num = (v: number | null | undefined) => (v === undefined ? undefined : v === null || (v as unknown) === "" ? null : Math.round(Number(v)));
  db.update(s.projects)
    .set({
      ...(p.name !== undefined && p.name.trim() ? { name: p.name.trim().slice(0, 80) } : {}),
      ...(p.description !== undefined ? { description: clean(p.description, 1000) } : {}),
      ...(p.goal !== undefined ? { goal: clean(p.goal, 300) || "미확인" } : {}),
      ...(p.stage !== undefined ? { stage: clean(p.stage, 60) || "미확인" } : {}),
      ...(p.nextPlan !== undefined ? { nextPlan: clean(p.nextPlan, 500) } : {}),
      ...(p.ownerId !== undefined ? { ownerId: p.ownerId || null } : {}),
      ...(num(p.budgetKrw) !== undefined ? { budgetMicros: num(p.budgetKrw) } : {}),
      ...(num(p.revenueKrw) !== undefined ? { revenueMicros: num(p.revenueKrw) } : {}),
      updatedAt: Date.now(),
    })
    .where(eq(s.projects.id, id))
    .run();
  return db.select().from(s.projects).where(eq(s.projects.id, id)).get()!;
}

export function projectDetail(db: DB, id: string) {
  const project = db.select().from(s.projects).where(eq(s.projects.id, id)).get();
  if (!project) return null;
  const tasks = db.select().from(s.tasks).where(eq(s.tasks.projectId, id)).orderBy(desc(s.tasks.createdAt)).all().filter((t) => t.type !== "CHAT");
  const reports = db.select({ id: s.reports.id, title: s.reports.title, employeeId: s.reports.employeeId, createdAt: s.reports.createdAt, meetingId: s.reports.meetingId }).from(s.reports).where(eq(s.reports.projectId, id)).orderBy(desc(s.reports.createdAt)).all();
  const meetings = db.select().from(s.meetings).where(eq(s.meetings.projectId, id)).orderBy(desc(s.meetings.createdAt)).all();
  const tx = db.select().from(s.financialTransactions).where(eq(s.financialTransactions.projectId, id)).all().filter((t) => !t.isSimulation);
  return {
    project: { ...project, budgetKrw: project.budgetMicros, revenueKrw: project.revenueMicros },
    tasks,
    reports,
    meetings,
    money: { income: tx.filter((t) => t.amountKrw > 0).reduce((a, t) => a + t.amountKrw, 0), expense: tx.filter((t) => t.amountKrw < 0).reduce((a, t) => a - t.amountKrw, 0) },
  };
}
