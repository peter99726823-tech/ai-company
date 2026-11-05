/**
 * Work-centred views over data the app already stores (no new tables):
 * - projectMemory: what the AI should know about a project without the CEO re-explaining it
 * - searchReports: the 결과물 보관함
 * - workBoard: what is running, waiting for the CEO, or failed
 * - usageSummary: API cost per day / month / employee, and Claude 자동 runs
 */
import { and, desc, eq, gte, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { parseReport } from "../tasks/complete";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

const clip = (t: string, n: number) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
const firstLine = (t: string) => (t.trim().split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").replace(/^\[회의 안건\]\s*/, "");

/**
 * Recent decisions and results for a project, kept short (only what helps the next task).
 * Returns "" when there is nothing yet. `excludeTaskId` keeps a task from quoting itself.
 */
export function projectMemory(db: DB, projectId: string | null, opts: { excludeTaskId?: string; maxChars?: number } = {}): string {
  if (!projectId) return "";
  const max = opts.maxChars ?? 3500;
  const decisions = db
    .select({ topic: s.meetings.topic, decision: s.meetings.decision, at: s.meetings.endedAt })
    .from(s.meetings)
    .where(and(eq(s.meetings.projectId, projectId), isNotNull(s.meetings.decision)))
    .orderBy(desc(s.meetings.endedAt))
    .limit(5)
    .all()
    .map((m) => {
      const d = JSON.parse(m.decision!) as { option: string; note?: string };
      return `- 회의 "${clip(firstLine(m.topic), 50)}" → 대표 결정: ${clip(d.option, 160)}${d.note ? ` (${clip(d.note, 80)})` : ""}`;
    });
  const reports = db
    .select({ id: s.reports.id, taskId: s.reports.taskId, title: s.reports.title, body: s.reports.body, employeeId: s.reports.employeeId, createdAt: s.reports.createdAt })
    .from(s.reports)
    .where(eq(s.reports.projectId, projectId))
    .orderBy(desc(s.reports.createdAt))
    .limit(8)
    .all()
    .filter((r) => r.taskId !== opts.excludeTaskId)
    .slice(0, 6)
    .map((r) => {
      const sum = parseReport(r.body).summary || r.body;
      return `- [${EMPLOYEE_BY_ID[r.employeeId]?.name ?? r.employeeId}] ${clip(r.title, 60)}: ${clip(sum, 220)}`;
    });
  if (!decisions.length && !reports.length) return "";
  let out = `# 이 프로젝트의 기억 (앱이 최근 결정과 결과를 자동으로 붙임. 다시 묻지 말고 이어서 판단하세요)`;
  if (decisions.length) out += `\n## 최근 대표 결정\n${decisions.join("\n")}`;
  if (reports.length) out += `\n## 최근 결과물 요약\n${reports.join("\n")}`;
  return out.length > max ? `${out.slice(0, max)}\n…(이하 생략)` : out;
}

export function searchReports(db: DB, f: { q?: string; projectId?: string | null; employeeId?: string | null; limit?: number }) {
  const conds = [];
  if (f.projectId) conds.push(eq(s.reports.projectId, f.projectId));
  if (f.employeeId) conds.push(eq(s.reports.employeeId, f.employeeId));
  const q = f.q?.trim();
  if (q) conds.push(or(like(s.reports.title, `%${q}%`), like(s.reports.body, `%${q}%`))!);
  const rows = db
    .select({ id: s.reports.id, title: s.reports.title, body: s.reports.body, employeeId: s.reports.employeeId, projectId: s.reports.projectId, meetingId: s.reports.meetingId, createdAt: s.reports.createdAt })
    .from(s.reports)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(s.reports.createdAt))
    .limit(Math.min(200, f.limit ?? 60))
    .all();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    employeeId: r.employeeId,
    projectId: r.projectId,
    meetingId: r.meetingId,
    createdAt: r.createdAt,
    summary: clip(parseReport(r.body).summary || r.body.replace(/^#.*$/gm, ""), 180),
  }));
}

/** What needs the CEO's attention, at a glance. */
export function workBoard(db: DB) {
  const cols = {
    id: s.tasks.id,
    title: s.tasks.title,
    type: s.tasks.type,
    status: s.tasks.status,
    employeeId: s.tasks.employeeId,
    projectId: s.tasks.projectId,
    executionMode: s.tasks.executionMode,
    statusMessage: s.tasks.statusMessage,
    error: s.tasks.error,
    meetingId: s.tasks.meetingId,
    createdAt: s.tasks.createdAt,
    updatedAt: s.tasks.updatedAt,
  };
  const active = db.select(cols).from(s.tasks).where(inArray(s.tasks.status, ["QUEUED", "PLANNING", "RUNNING"])).orderBy(desc(s.tasks.createdAt)).limit(50).all();
  const approvals = db.select(cols).from(s.tasks).where(eq(s.tasks.status, "WAITING_APPROVAL")).orderBy(desc(s.tasks.createdAt)).limit(50).all();
  const failed = db
    .select(cols)
    .from(s.tasks)
    .where(and(eq(s.tasks.status, "FAILED"), gte(s.tasks.updatedAt, Date.now() - 7 * 86400_000)))
    .orderBy(desc(s.tasks.updatedAt))
    .limit(20)
    .all();
  const undecided = db
    .select({ id: s.meetings.id, topic: s.meetings.topic, endedAt: s.meetings.endedAt, projectId: s.meetings.projectId })
    .from(s.meetings)
    .where(and(eq(s.meetings.status, "COMPLETED"), sql`${s.meetings.decision} is null`))
    .orderBy(desc(s.meetings.endedAt))
    .limit(20)
    .all()
    .map((m) => ({ ...m, title: clip(firstLine(m.topic), 80) }));
  return { active, approvals, failed, undecided };
}

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** API cost (measured by the worker) and Claude 자동 runs (counted; their tokens are on the viewer's claude.ai plan). */
export function usageSummary(db: DB) {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const since = Math.min(monthStart, Date.now() - 14 * 86400_000);
  const rows = db
    .select({ at: s.apiUsage.createdAt, micros: s.apiUsage.costMicros, est: s.apiUsage.costIsEstimate, input: s.apiUsage.inputTokens, output: s.apiUsage.outputTokens, employeeId: s.tasks.employeeId })
    .from(s.apiUsage)
    .leftJoin(s.tasks, eq(s.tasks.id, s.apiUsage.taskId))
    .where(gte(s.apiUsage.createdAt, since))
    .all();
  const today = dayKey(Date.now());
  const sum = (list: typeof rows) => ({ usd: list.reduce((a, r) => a + r.micros, 0) / 1e6, calls: list.length, tokens: list.reduce((a, r) => a + r.input + r.output, 0) });
  const byEmployee: Record<string, { usd: number; calls: number }> = {};
  for (const r of rows.filter((r) => r.at >= monthStart)) {
    const k = r.employeeId ?? "unknown";
    byEmployee[k] ??= { usd: 0, calls: 0 };
    byEmployee[k].usd += r.micros / 1e6;
    byEmployee[k].calls++;
  }
  const byDay: Record<string, { usd: number; calls: number; claude: number }> = {};
  for (let i = 13; i >= 0; i--) byDay[dayKey(Date.now() - i * 86400_000)] = { usd: 0, calls: 0, claude: 0 };
  for (const r of rows) {
    const k = dayKey(r.at);
    if (byDay[k]) {
      byDay[k].usd += r.micros / 1e6;
      byDay[k].calls++;
    }
  }
  const claudeRuns = db
    .select({ at: s.taskEvents.createdAt })
    .from(s.taskEvents)
    .where(and(gte(s.taskEvents.createdAt, since), like(s.taskEvents.message, "%(Claude 자동)%")))
    .all();
  for (const c of claudeRuns) {
    const k = dayKey(c.at);
    if (byDay[k]) byDay[k].claude++;
  }
  return {
    today: sum(rows.filter((r) => dayKey(r.at) === today)),
    month: sum(rows.filter((r) => r.at >= monthStart)),
    isEstimate: rows.some((r) => r.est),
    byEmployee: Object.entries(byEmployee)
      .map(([employeeId, v]) => ({ employeeId, ...v }))
      .sort((a, b) => b.usd - a.usd),
    byDay: Object.entries(byDay).map(([day, v]) => ({ day, ...v })),
    claudeAuto: { today: claudeRuns.filter((c) => dayKey(c.at) === today).length, month: claudeRuns.filter((c) => c.at >= monthStart).length },
    dailyBudgetUsd: Number(process.env.AI_DAILY_BUDGET_USD ?? 5),
  };
}
