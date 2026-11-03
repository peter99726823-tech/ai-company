/** Meetings + manual (paste) mode. AI calls go only to the TEST-ONLY mock server. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-m-"));
process.env.DATABASE_PATH = path.join(dir, "m.db");
process.env.AI_DAILY_BUDGET_USD = "5";

const { getDb } = await import("../src/server/db/client");
const svc = await import("../src/server/tasks/service");
const runner = await import("../src/server/tasks/runner");
const ms = await import("../src/server/meetings/service");
const fmt = await import("../src/server/meetings/format");
const s = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const db = getDb();
const PORT = 4312;
let mock: ChildProcess;

before(async () => {
  mock = spawn(process.execPath, ["e2e/mock-anthropic.mjs", String(PORT)], { stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
});
after(() => mock?.kill());

const ANSWER = (ids: string[]) =>
  ids.map((id) => `=== 부서: ${id} | 이름 ===\n${id} 의견입니다. 근거와 대안.`).join("\n") +
  "\n=== 종합: CEO Advisor ===\n## 회의 요약\n요약 문장입니다. 충분히 깁니다.\n## 대표 결정 선택지\n- [A] 진행\n- [B] 보류\n## 후속 업무 제안\n- 담당: cto | 업무: 범위 정리\n- 담당: nobody | 업무: 무시됨\n";

test("parseMeeting reads statements, options and follow-ups", () => {
  const p = fmt.parseMeeting(ANSWER(["validator", "ceo-advisor"]), ["validator", "ceo-advisor"]);
  assert.equal(p.statements.length, 2);
  assert.deepEqual(p.options.map((o) => o.key), ["A", "B"]);
  assert.deepEqual(p.followUps, [{ employeeId: "cto", instruction: "범위 정리" }]);
});

test("parseMeeting refuses an answer missing a participant (no gap filling)", () => {
  assert.throws(() => fmt.parseMeeting(ANSWER(["validator"]), ["validator", "cto"]), /도윤/);
  assert.throws(() => fmt.parseMeeting("=== 부서: cto | x ===\nhi", ["cto"]), /종합/);
});

test("meeting prompt lists participants in order with the CEO Advisor last", () => {
  const m = ms.createMeeting(db, { topic: "Number Maze 출시 전략", participantIds: ["ceo-advisor", "validator", "marketing"], executionMode: "manual" });
  assert.deepEqual(m.participants.map((p) => p.employeeId), ["validator", "marketing", "ceo-advisor"]);
  const prompt = ms.getManualPrompt(db, m.task!.id);
  assert.match(prompt, /PARTICIPANTS: validator,marketing,ceo-advisor/);
  assert.match(prompt, /Number Maze 출시 전략/);
  assert.match(prompt, /=== 종합: CEO Advisor ===/);
});

test("manual meetings are never picked up by the API worker", () => {
  assert.equal(runner.claimNext(db, "w"), null);
});

test("manual submit: bad paste is rejected and nothing is saved", () => {
  const m = ms.recentMeetings(db)[0];
  assert.throws(() => ms.submitManualAnswer(db, m.task!.id, "짧음"), /너무 짧/);
  assert.throws(() => ms.submitManualAnswer(db, m.task!.id, ANSWER(["validator", "ceo-advisor"])), /유나/);
  assert.equal(svc.getTask(db, m.task!.id)!.status, "QUEUED");
  assert.equal(db.select().from(s.reports).all().length, 0);
});

test("manual submit: a full answer completes the meeting and stores each statement", () => {
  const m = ms.recentMeetings(db)[0];
  const reportId = ms.submitManualAnswer(db, m.task!.id, ANSWER(["validator", "marketing", "ceo-advisor"]));
  const full = ms.getMeeting(db, m.id)!;
  assert.equal(full.meeting.status, "COMPLETED");
  assert.equal(full.task!.status, "COMPLETED");
  assert.equal(full.report!.id, reportId);
  assert.match(full.report!.body, /claude\.ai에서 받은 답변/);
  assert.ok(full.participants.every((p) => p.statement && p.statement.includes(p.employeeId)));
  assert.equal(db.select().from(s.apiUsage).all().length, 0, "manual mode must not record API cost");
  const types = db.select().from(s.taskEvents).where(eq(s.taskEvents.meetingId, m.id)).all().map((e) => e.type);
  assert.ok(types.includes("MEETING_STARTED") && types.includes("MEETING_ENDED"));
});

test("decision is recorded once and creates the selected follow-up tasks", () => {
  const m = ms.recentMeetings(db)[0];
  const r = ms.decideMeeting(db, m.id, { option: "A", note: "빠르게", followUps: [{ employeeId: "cto", instruction: "범위 정리" }], executionMode: "manual" });
  assert.equal(r.created.length, 1);
  const t = svc.getTask(db, r.created[0])!;
  assert.equal(t.employeeId, "cto");
  assert.equal(t.executionMode, "manual");
  assert.equal(t.parentTaskId, m.task!.id);
  assert.throws(() => ms.decideMeeting(db, m.id, { option: "B", followUps: [], executionMode: "manual" }), /이미 결정/);
  svc.requestCancel(db, t.id);
});

test("API-mode meeting through the worker (mock API)", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
  const m = ms.createMeeting(db, { topic: "가격 정책", participantIds: ["pricing", "sales", "bookkeeper"], executionMode: "api" });
  await runner.runTask(db, "w", runner.claimNext(db, "w")!);
  const full = ms.getMeeting(db, m.meeting.id)!;
  assert.equal(full.task!.status, "COMPLETED", full.task!.error ?? "");
  assert.equal(full.participants.length, 4);
  assert.ok(full.participants.every((p) => p.statement?.includes("테스트용 가짜 발언")));
  assert.equal(db.select().from(s.apiUsage).where(eq(s.apiUsage.taskId, full.task!.id)).all().length, 1);
});

test("API-mode meeting whose answer skips a participant FAILS instead of inventing it", async () => {
  const m = ms.createMeeting(db, { topic: "MOCK_BADMEETING", participantIds: ["cto", "ops"], executionMode: "api" });
  await runner.runTask(db, "w", runner.claimNext(db, "w")!);
  const full = ms.getMeeting(db, m.meeting.id)!;
  assert.equal(full.task!.status, "FAILED");
  assert.match(full.task!.error!, /회의 형식/);
  assert.equal(full.report, null);
});

test("manual single-employee task: paste answer → report", () => {
  const t = svc.createTask(db, { employeeId: "marketing", instruction: "블로그 글 써줘", executionMode: "manual" });
  assert.match(ms.getManualPrompt(db, t.id), /블로그 글 써줘/);
  ms.submitManualAnswer(db, t.id, "## 요약\n블로그 초안입니다. 충분히 긴 답변 본문입니다.\n## 결과물\n본문");
  assert.equal(svc.getTask(db, t.id)!.status, "COMPLETED");
});

test("batch: decision follow-ups run in one answer, all-or-nothing, then a CEO synthesis", async () => {
  const batch = await import("../src/server/tasks/batch");
  const m = ms.createMeeting(db, { topic: "배치 테스트 회의", participantIds: ["validator", "planner", "ai-engineer"], executionMode: "manual" });
  const ids = m.participants.map((p) => p.employeeId);
  ms.submitManualAnswer(db, m.task!.id, ANSWER(ids));
  const follow = [
    { employeeId: "planner", instruction: "기획서 목차 초안" },
    { employeeId: "ai-engineer", instruction: "백테스트 지시문" },
  ];
  const { created } = ms.decideMeeting(db, m.meeting.id, { option: "[A] 진행", followUps: follow, executionMode: "manual" });
  assert.equal(created.length, 2);
  assert.deepEqual(ms.getMeeting(db, m.meeting.id)!.followUps!.map((f) => f.id), created);

  const prompt = batch.batchPrompt(db, created);
  assert.ok(created.every((id) => prompt.includes(`=== 업무: ${id}`)) && prompt.includes("=== 종합: CEO Advisor ==="));
  assert.ok(prompt.includes("기획서 목차 초안") && prompt.includes("이전 결과물"), "each task carries its instruction and the meeting result");

  const report = (n: string) => `## 요약\n${n} 결과 요약입니다. 충분히 긴 본문입니다.\n## 결과물\n${n}-결과물\n## 다음 추천 업무\n- 해당 없음`;
  // missing one task → nothing saved
  assert.throws(() => batch.submitBatch(db, created, `=== 업무: ${created[0]} | 은채 ===\n${report("A")}\n=== 종합: CEO Advisor ===\n## 실행 결과 요약\n종합 내용이 충분히 깁니다. 충분히 깁니다. 충분히.`, m.meeting.id), /보고서가 답변에 없거나/);
  assert.equal(svc.getTask(db, created[0])!.status, "QUEUED");

  const text = `=== 업무: ${created[0]} | 은채 ===\n${report("A")}\n=== 업무: ${created[1]} | 준서 ===\n${report("B")}\n=== 종합: CEO Advisor ===\n## 실행 결과 요약\n- 은채: 목차\n- 준서: 지시문\n## 다음 행동\n- 오늘 제출`;
  const r = batch.submitBatch(db, created, text, m.meeting.id);
  assert.equal(r.reports.length, 2);
  assert.ok(created.every((id) => svc.getTask(db, id)!.status === "COMPLETED"));
  const synth = db.select().from(s.reports).where(eq(s.reports.id, r.synthesisReportId)).get()!;
  assert.equal(synth.employeeId, "ceo-advisor");
  assert.ok(synth.body.includes("오늘 제출"));
  const d = JSON.parse(ms.getMeeting(db, m.meeting.id)!.meeting.decision!);
  assert.equal(d.synthesisReportId, r.synthesisReportId);
  // re-submitting finished tasks is refused
  assert.throws(() => batch.submitBatch(db, created, text, m.meeting.id), /이미 끝났거나/);
});
