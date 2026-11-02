import "server-only";
import { and, desc, eq, inArray, gte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import * as s from "../db/schema";
import type { EmployeeLook } from "@/domain/types";
import { recentMeetings } from "../meetings/service";
import { getAutonomy, listRoutines } from "../autonomy/service";

function startOfTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Everything the main screen needs, read from the real database. Nothing here is simulated. */
export function getOfficeSnapshot() {
  const db = getDb();
  const company = db.select().from(s.company).limit(1).all()[0] ?? null;
  const employees = db
    .select()
    .from(s.employees)
    .all()
    .map((e) => ({ ...e, expertise: JSON.parse(e.expertise) as string[], look: JSON.parse(e.look) as EmployeeLook }));
  const projects = db.select().from(s.projects).all();

  const statusCounts = db
    .select({ status: s.tasks.status, n: sql<number>`count(*)` })
    .from(s.tasks)
    .groupBy(s.tasks.status)
    .all();
  const c = Object.fromEntries(statusCounts.map((r) => [r.status, r.n])) as Record<string, number>;

  const usage = db
    .select({ micros: sql<number>`coalesce(sum(${s.apiUsage.costMicros}),0)`, calls: sql<number>`count(*)`, est: sql<number>`coalesce(max(${s.apiUsage.costIsEstimate}),0)` })
    .from(s.apiUsage)
    .where(gte(s.apiUsage.createdAt, startOfTodayLocal()))
    .all()[0];

  const recentEvents = db.select().from(s.taskEvents).orderBy(desc(s.taskEvents.id)).limit(40).all();
  // Chat replies live in the chat window, not in the task lists.
  const recentCompleted = db.select().from(s.tasks).where(and(eq(s.tasks.status, "COMPLETED"), ne(s.tasks.type, "CHAT"))).orderBy(desc(s.tasks.finishedAt)).limit(8).all();
  const reportIds = Object.fromEntries(
    db
      .select({ taskId: s.reports.taskId, id: s.reports.id })
      .from(s.reports)
      .where(inArray(s.reports.taskId, recentCompleted.map((t) => t.id).concat("")))
      .all()
      .map((r) => [r.taskId, r.id]),
  ) as Record<string, string>;
  const maxEventId = db.select({ m: sql<number>`coalesce(max(${s.taskEvents.id}),0)` }).from(s.taskEvents).get()!.m;
  const attention = db
    .select()
    .from(s.tasks)
    .where(or(inArray(s.tasks.status, ["FAILED", "WAITING_APPROVAL"]), and(eq(s.tasks.status, "QUEUED"), eq(s.tasks.executionMode, "manual"))))
    .orderBy(desc(s.tasks.updatedAt))
    .limit(8)
    .all();

  const active = db
    .select()
    .from(s.tasks)
    .where(inArray(s.tasks.status, ["QUEUED", "PLANNING", "RUNNING", "WAITING_APPROVAL"]))
    .orderBy(desc(s.tasks.updatedAt))
    .all();
  const reportCounts = db
    .select({ employeeId: s.reports.employeeId, n: sql<number>`count(*)` })
    .from(s.reports)
    .groupBy(s.reports.employeeId)
    .all();
  const byEmployee = Object.fromEntries(
    employees.map((e) => [
      e.id,
      {
        activeTask: active.find((t) => t.employeeId === e.id) ?? null,
        lastFinished:
          db
            .select()
            .from(s.tasks)
            .where(and(eq(s.tasks.employeeId, e.id), inArray(s.tasks.status, ["COMPLETED", "FAILED", "CANCELED"])))
            .orderBy(desc(s.tasks.finishedAt))
            .limit(1)
            .get() ?? null,
        recentCompleted: recentCompleted.filter((t) => t.employeeId === e.id).slice(0, 3).map((t) => ({ ...t, reportId: reportIds[t.id] ?? null })),
        reportCount: reportCounts.find((r) => r.employeeId === e.id)?.n ?? 0,
      },
    ]),
  );

  return {
    company,
    byEmployee,
    employees,
    projects,
    counts: {
      running: (c.PLANNING ?? 0) + (c.RUNNING ?? 0),
      queued: c.QUEUED ?? 0,
      waitingApproval: c.WAITING_APPROVAL ?? 0,
      failed: c.FAILED ?? 0,
      completed: c.COMPLETED ?? 0,
    },
    todayCost: { usd: (usage?.micros ?? 0) / 1_000_000, calls: usage?.calls ?? 0, isEstimate: !!usage?.est },
    recentEvents,
    recentCompleted: recentCompleted.map((t) => ({ ...t, reportId: reportIds[t.id] ?? null })),
    maxEventId,
    meetings: recentMeetings(db, 6),
    autonomy: getAutonomy(db),
    routines: listRoutines(db),
    attention,
    serverTime: Date.now(),
  };
}

export type OfficeSnapshot = ReturnType<typeof getOfficeSnapshot>;
