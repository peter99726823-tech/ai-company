/** PHASE 4 autonomy + finance + projects + backup (server logic, temp DB, no AI calls). */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-a-"));
process.env.DATABASE_PATH = path.join(dir, "a.db");

const { getDb, getSqlite } = await import("../src/server/db/client");
const svc = await import("../src/server/tasks/service");
const ms = await import("../src/server/meetings/service");
const au = await import("../src/server/autonomy/service");
const fin = await import("../src/server/finance/service");
const prj = await import("../src/server/projects/service");
const bk = await import("../src/server/backup");
const s = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const db = getDb();

const at = (y: number, mo: number, d: number, h: number) => new Date(y, mo - 1, d, h, 0, 0, 0).getTime();

test("nextRunAfter: daily / weekly / monthly at the given hour", () => {
  const mon = at(2026, 11, 2, 10); // Monday 10:00
  assert.equal(au.nextRunAfter({ frequency: "daily", hour: 9 }, mon), at(2026, 11, 3, 9));
  assert.equal(au.nextRunAfter({ frequency: "daily", hour: 11 }, mon), at(2026, 11, 2, 11));
  assert.equal(au.nextRunAfter({ frequency: "weekly", dayOfWeek: 5, hour: 9 }, mon), at(2026, 11, 6, 9));
  assert.equal(au.nextRunAfter({ frequency: "monthly", dayOfMonth: 1, hour: 9 }, mon), at(2026, 12, 1, 9));
});

test("default mode is manual: due routines are skipped and logged, nothing is created", () => {
  assert.equal(au.getAutonomy(db).mode, "manual");
  const r = au.createRoutine(db, { employeeId: "bookkeeper", title: "주간 지출 점검", instruction: "이번 주 지출을 점검", frequency: "daily", hour: 9 }, at(2026, 11, 2, 8));
  const before = db.select().from(s.tasks).all().length;
  const out = au.runScheduler(db, at(2026, 11, 2, 9, ) + 1000);
  assert.deepEqual(out, [{ id: r.id, result: "skipped" }]);
  assert.equal(db.select().from(s.tasks).all().length, before);
  assert.ok(au.listRoutines(db)[0].nextRunAt > at(2026, 11, 2, 10), "advanced to the next day");
  assert.equal(au.runScheduler(db, at(2026, 11, 2, 9) + 2000).length, 0, "never fires twice for one due time");
});

test("semi mode: a due routine becomes a proposal waiting for approval", () => {
  au.setAutonomy(db, { mode: "semi" });
  const out = au.runScheduler(db, at(2026, 11, 3, 9) + 1000);
  assert.equal(out[0].result, "proposed");
  const t = db.select().from(s.tasks).where(eq(s.tasks.source, "routine")).get()!;
  assert.equal(t.status, "WAITING_APPROVAL");
  au.approveProposal(db, t.id, "manual");
  assert.equal(svc.getTask(db, t.id)!.status, "QUEUED");
  assert.throws(() => au.approveProposal(db, t.id, "manual"), /승인 대기/);
  svc.requestCancel(db, t.id);
});

test("auto mode runs routines up to the daily limit, then proposes", () => {
  au.setAutonomy(db, { mode: "auto", dailyAutoLimit: 1 });
  const now = Date.now();
  // make two routines due right now
  const a = au.createRoutine(db, { employeeId: "ops", title: "A", instruction: "a", frequency: "daily", hour: 3 });
  const b = au.createRoutine(db, { employeeId: "ops", title: "B", instruction: "b", frequency: "daily", hour: 3 });
  db.update(s.routines).set({ nextRunAt: now - 1000, enabled: true }).where(eq(s.routines.id, a.id)).run();
  db.update(s.routines).set({ nextRunAt: now - 500, enabled: true }).where(eq(s.routines.id, b.id)).run();
  db.update(s.routines).set({ enabled: false }).where(eq(s.routines.title, "주간 지출 점검")).run();
  const out = au.runScheduler(db, now);
  assert.deepEqual(out.map((o) => o.result).sort(), ["proposed", "queued"]);
  const tasks = db.select().from(s.tasks).where(eq(s.tasks.employeeId, "ops")).all();
  assert.ok(tasks.every((t) => t.executionMode === "manual"), "no API without a key");
});

test("'run now' fires whatever the mode, and rejecting a proposal cancels it", () => {
  au.setAutonomy(db, { mode: "manual" });
  const r = au.listRoutines(db)[0];
  assert.equal(au.runRoutineNow(db, r.id).result, "queued");
  const prop = db.select().from(s.tasks).where(eq(s.tasks.status, "WAITING_APPROVAL")).get()!;
  au.rejectProposal(db, prop.id);
  assert.equal(svc.getTask(db, prop.id)!.status, "CANCELED");
});

test("report follow-ups become proposals only in semi/auto mode", () => {
  const mk = () => {
    const t = svc.createTask(db, { employeeId: "validator", instruction: "검증", executionMode: "manual" });
    ms.submitManualAnswer(db, t.id, "## 요약\n요약 문장입니다. 충분히 깁니다.\n## 다음 추천 업무\n- 경쟁사 3곳 가격 조사\n- 설문 10명\n- 세 번째는 무시");
    return t.id;
  };
  mk();
  assert.equal(db.select().from(s.tasks).where(eq(s.tasks.source, "proposal")).all().length, 0, "manual mode: no proposals");
  au.setAutonomy(db, { mode: "semi" });
  const id = mk();
  const props = db.select().from(s.tasks).where(eq(s.tasks.parentTaskId, id)).all();
  assert.equal(props.length, 2);
  assert.ok(props.every((p) => p.status === "WAITING_APPROVAL" && p.source === "proposal"));
});

test("finance: real and simulated entries are summed separately and attached to the bookkeeper's prompt", () => {
  fin.addTransaction(db, { date: "2026-11-01", description: "외주 계약금", amountKrw: 500000 });
  fin.addTransaction(db, { date: "2026-11-02", description: "서버 비용", amountKrw: -30000, category: "고정비" });
  fin.addTransaction(db, { date: "2026-11-03", description: "가상 매출", amountKrw: 1000000, isSimulation: true });
  assert.throws(() => fin.addTransaction(db, { date: "11/1", description: "x", amountKrw: 1 }), /YYYY-MM-DD/);
  const l = fin.listTransactions(db, "2026-11");
  assert.deepEqual(l.real, { income: 500000, expense: 30000, net: 470000, count: 2 });
  assert.equal(l.simulation.income, 1000000);
  const t = svc.createTask(db, { employeeId: "bookkeeper", instruction: "11월 손익 분석", type: "TRANSACTIONS", executionMode: "manual" });
  const prompt = ms.getManualPrompt(db, t.id);
  assert.match(prompt, /외주 계약금 \| 500,000/);
  assert.match(prompt, /가상 매출 .* 시뮬레이션/);
  svc.requestCancel(db, t.id);
});

test("projects: create, edit, detail with linked work", () => {
  const p = prj.createProject(db, { name: "새 앱", description: "테스트" });
  prj.updateProject(db, p.id, { stage: "개발 중", budgetKrw: 300000, goal: "베타 20명" });
  svc.createTask(db, { employeeId: "cto", instruction: "MVP", projectId: p.id, executionMode: "manual" });
  const d = prj.projectDetail(db, p.id)!;
  assert.equal(d.project.stage, "개발 중");
  assert.equal(d.project.budgetKrw, 300000);
  assert.equal(d.tasks.length, 1);
});

test("backup round-trip: JSON → SQLite bytes that open with all data", () => {
  const j = bk.toBackupJson(new Uint8Array(getSqlite().serialize()));
  assert.equal(j.format, "ai-company-backup");
  const bytes = bk.fromBackupJson(JSON.parse(JSON.stringify(j)));
  const f = path.join(dir, "restored.db");
  fs.writeFileSync(f, bytes);
  const r = new Database(f, { readonly: true });
  assert.equal((r.prepare("select count(*) n from employees").get() as { n: number }).n, 9);
  assert.equal((r.prepare("select count(*) n from financial_transactions").get() as { n: number }).n, 3);
  r.close();
  assert.throws(() => bk.fromBackupJson({ format: "other" }), /백업 파일이 아닙니다/);
});
