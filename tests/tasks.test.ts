/**
 * Task Orchestrator tests against a temporary SQLite file.
 * AI calls go to the TEST-ONLY mock server (e2e/mock-anthropic.mjs) — never to the real API.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-"));
process.env.DATABASE_PATH = path.join(dir, "t.db");
process.env.AI_DAILY_BUDGET_USD = "5";
process.env.AI_MAX_CALLS_PER_TASK = "2";
delete process.env.ANTHROPIC_API_KEY;

const { getDb } = await import("../src/server/db/client");
const svc = await import("../src/server/tasks/service");
const runner = await import("../src/server/tasks/runner");
const s = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const { parseReport } = runner;
const { estimateCostMicros } = await import("../src/server/ai/pricing");

const db = getDb();
let mock: ChildProcess;
const PORT = 4311;

before(async () => {
  mock = spawn(process.execPath, ["e2e/mock-anthropic.mjs", String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("mock did not start");
});
after(() => {
  mock?.kill();
});

const events = (id: string) => db.select().from(s.taskEvents).where(eq(s.taskEvents.taskId, id)).all().map((e) => e.type);

test("seed: nine employees each have a versioned system prompt", () => {
  assert.equal(db.select().from(s.employees).all().length, 9);
  assert.equal(db.select().from(s.employeePrompts).all().length, 9);
});

test("createTask stores the task as QUEUED with CREATED + ASSIGNED events", () => {
  const t = svc.createTask(db, { employeeId: "validator", instruction: "테스트 업무", type: "BUSINESS_IDEA", projectId: "number-maze" });
  assert.equal(t.status, "QUEUED");
  assert.deepEqual(events(t.id), ["TASK_CREATED", "TASK_ASSIGNED"]);
  svc.requestCancel(db, t.id); // clean up for the following tests
});

test("createTask rejects bad input and unsupported types", () => {
  assert.throws(() => svc.createTask(db, { employeeId: "validator", instruction: "  " }), svc.TaskInputError);
  assert.throws(() => svc.createTask(db, { employeeId: "nobody", instruction: "x" }), svc.TaskInputError);
  assert.throws(() => svc.createTask(db, { employeeId: "contract", instruction: "x", type: "MULTI_DEPT" }), /회의 소집/);
});

test("only one worker can claim a task (no duplicate execution)", () => {
  const t = svc.createTask(db, { employeeId: "cto", instruction: "claim test" });
  const a = runner.claimNext(db, "w1");
  const b = runner.claimNext(db, "w2");
  assert.equal(a?.id, t.id);
  assert.equal(b, null);
  assert.equal(svc.getTask(db, t.id)!.leaseOwner, "w1");
  // finish it so later tests start from an empty queue
  svc.transition(db, t.id, { from: ["PLANNING"], patch: { status: "CANCELED" }, event: { type: "TASK_CANCELED", message: "test" } });
});

test("canceling a queued task is immediate and blocks later claims", () => {
  const t = svc.createTask(db, { employeeId: "ops", instruction: "cancel me" });
  assert.equal(svc.requestCancel(db, t.id).ok, true);
  assert.equal(svc.getTask(db, t.id)!.status, "CANCELED");
  assert.equal(runner.claimNext(db, "w1"), null);
});

test("without an API key the task FAILS with a clear reason (no fake result)", async () => {
  const t = svc.createTask(db, { employeeId: "validator", instruction: "no key test" });
  const claimed = runner.claimNext(db, "w1")!;
  await runner.runTask(db, "w1", claimed);
  const after = svc.getTask(db, t.id)!;
  assert.equal(after.status, "FAILED");
  assert.match(after.error!, /ANTHROPIC_API_KEY/);
  assert.equal(db.select().from(s.reports).where(eq(s.reports.taskId, t.id)).all().length, 0);
  assert.ok(events(t.id).includes("TASK_FAILED"));
});

test("with the mock API: streams, saves the report, records usage and cost", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
  const t = svc.createTask(db, { employeeId: "validator", instruction: "Number Maze 수익화 전략 분석", projectId: "number-maze" });
  await runner.runTask(db, "w1", runner.claimNext(db, "w1")!);
  const after = svc.getTask(db, t.id)!;
  assert.equal(after.status, "COMPLETED", after.error ?? "");
  assert.equal(after.progress, 100);
  const rep = db.select().from(s.reports).where(eq(s.reports.taskId, t.id)).get()!;
  assert.match(rep.body, /테스트용 가짜 응답/);
  assert.deepEqual(JSON.parse(rep.nextTasks!), ["실제 API 키로 같은 업무를 다시 실행하기"]);
  const use = db.select().from(s.apiUsage).where(eq(s.apiUsage.taskId, t.id)).get()!;
  assert.equal(use.inputTokens, 1200);
  assert.equal(use.outputTokens, 900);
  assert.equal(use.costMicros, estimateCostMicros("claude-opus-5-5", { input_tokens: 1200, output_tokens: 900 }).micros);
  const ev = events(t.id);
  for (const type of ["TASK_STARTED", "TASK_PROGRESS", "TASK_COMPLETED"]) assert.ok(ev.includes(type), type);
  const exec = db.select().from(s.taskExecutions).where(eq(s.taskExecutions.taskId, t.id)).all();
  assert.equal(exec.length, 1);
  assert.equal(exec[0].requestId, "req_mock_1");
});

test("server errors are retried up to the call limit, then FAILED", async () => {
  const t = svc.createTask(db, { employeeId: "cto", instruction: "MOCK_500" });
  await runner.runTask(db, "w1", runner.claimNext(db, "w1")!);
  const after = svc.getTask(db, t.id)!;
  assert.equal(after.status, "FAILED");
  assert.equal(after.attempts, 2);
  assert.match(after.error!, /최대 호출 횟수/);
});

test("refusals are reported as failures with the category", async () => {
  const t = svc.createTask(db, { employeeId: "cto", instruction: "MOCK_REFUSE" });
  await runner.runTask(db, "w1", runner.claimNext(db, "w1")!);
  const after = svc.getTask(db, t.id)!;
  assert.equal(after.status, "FAILED");
  assert.match(after.error!, /거절.*cyber/);
});

test("canceling a running task aborts the AI stream", async () => {
  const t = svc.createTask(db, { employeeId: "marketing", instruction: "MOCK_SLOW" });
  const run = runner.runTask(db, "w1", runner.claimNext(db, "w1")!);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal(svc.requestCancel(db, t.id).ok, true);
  await run;
  assert.equal(svc.getTask(db, t.id)!.status, "CANCELED");
  assert.equal(db.select().from(s.reports).where(eq(s.reports.taskId, t.id)).all().length, 0);
});

test("daily budget blocks new runs", async () => {
  process.env.AI_DAILY_BUDGET_USD = "0.000001";
  const t = svc.createTask(db, { employeeId: "pricing", instruction: "budget" });
  await runner.runTask(db, "w1", runner.claimNext(db, "w1")!);
  assert.match(svc.getTask(db, t.id)!.error!, /일일 한도/);
  process.env.AI_DAILY_BUDGET_USD = "5";
});

test("retry puts a failed task back in the queue", () => {
  const failed = db.select().from(s.tasks).where(eq(s.tasks.status, "FAILED")).get()!;
  assert.equal(svc.retryTask(db, failed.id).ok, true);
  assert.equal(svc.getTask(db, failed.id)!.status, "QUEUED");
  svc.requestCancel(db, failed.id);
});

test("a worker that dies mid-task leaves it FAILED once the lease expires", () => {
  const t = svc.createTask(db, { employeeId: "ops", instruction: "stale" });
  runner.claimNext(db, "dead-worker");
  db.update(s.tasks).set({ leaseUntil: Date.now() - 1 }).where(eq(s.tasks.id, t.id)).run();
  assert.equal(runner.failStaleTasks(db), 1);
  assert.match(svc.getTask(db, t.id)!.error!, /실행기/);
});

test("parseReport extracts the structured sections", () => {
  const p = parseReport("## 요약\n좋음\n## 확인된 사실\n- A\n- 해당 없음\n## 다음 추천 업무\n* B\n");
  assert.equal(p.summary, "좋음");
  assert.deepEqual(p.facts, ["A"]);
  assert.deepEqual(p.nextTasks, ["B"]);
});
