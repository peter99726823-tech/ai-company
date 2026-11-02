/** Chat with employees and CEO decisions on reports. AI only via the TEST-ONLY mock server. */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-c-"));
process.env.DATABASE_PATH = path.join(dir, "c.db");
process.env.AI_DAILY_BUDGET_USD = "5";

const { getDb } = await import("../src/server/db/client");
const svc = await import("../src/server/tasks/service");
const runner = await import("../src/server/tasks/runner");
const ms = await import("../src/server/meetings/service");
const chat = await import("../src/server/chat/service");
const rep = await import("../src/server/reports/service");
const s = await import("../src/server/db/schema");
const { eq } = await import("drizzle-orm");
const db = getDb();
const PORT = 4313;
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

test("chat (paste mode): message → prompt with history → pasted reply saved as a message", () => {
  const c1 = chat.sendChat(db, { employeeId: "validator", text: "Number Maze 시장성 어때?", executionMode: "manual", projectId: "number-maze" });
  assert.equal(c1.messages.length, 1);
  assert.ok(c1.pending);
  assert.throws(() => chat.sendChat(db, { employeeId: "validator", text: "또", executionMode: "manual", projectId: "number-maze" }), /먼저/);
  const prompt = ms.getManualPrompt(db, c1.pending!.id);
  assert.match(prompt, /1:1로 대화/);
  assert.match(prompt, /대표: Number Maze 시장성 어때\?/);
  assert.doesNotMatch(prompt, /## 다음 추천 업무/); // no report format in chat
  ms.submitManualAnswer(db, c1.pending!.id, "퍼즐 장르는 경쟁이 많아서 차별점부터 확인해야 합니다. 이건 테스트 답변입니다.");
  const c2 = chat.getChat(db, "validator", "number-maze");
  assert.equal(c2.pending, null);
  assert.deepEqual(c2.messages.map((m) => m.role), ["ceo", "employee"]);
  assert.equal(db.select().from(s.reports).all().length, 0, "chat replies are messages, not reports");
});

test("chat history is kept per project and fed into the next prompt", () => {
  const other = chat.getChat(db, "validator", null);
  assert.equal(other.messages.length, 0, "a different project starts a separate conversation");
  const c = chat.sendChat(db, { employeeId: "validator", text: "그럼 차별점은 뭐로?", executionMode: "manual", projectId: "number-maze" });
  const prompt = ms.getManualPrompt(db, c.pending!.id);
  assert.match(prompt, /서진: 퍼즐 장르는 경쟁이 많아서/);
  svc.requestCancel(db, c.pending!.id);
});

test("chat (API mode via mock) stores the reply", async () => {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
  chat.sendChat(db, { employeeId: "cto", text: "기술 스택 추천?", executionMode: "api" });
  await runner.runTask(db, "w", runner.claimNext(db, "w")!);
  const c = chat.getChat(db, "cto", null);
  assert.equal(c.messages.length, 2);
  assert.match(c.messages[1].content, /테스트용 가짜 응답/);
});

let reportId = "";
test("report decisions: revision creates a linked follow-up whose prompt contains the earlier report", () => {
  const t = svc.createTask(db, { employeeId: "marketing", instruction: "출시 홍보 문구", executionMode: "manual", projectId: "number-maze" });
  reportId = ms.submitManualAnswer(db, t.id, "## 요약\n첫 번째 홍보 문구 초안입니다. 충분히 깁니다.\n## 결과물\n원본문구ABC");
  assert.throws(() => rep.actOnReport(db, reportId, { action: "REVISION", executionMode: "manual" }), /고쳐야/);
  const r = rep.actOnReport(db, reportId, { action: "REVISION", note: "더 짧게", executionMode: "manual" });
  const fu = svc.getTask(db, r.createdTaskId!)!;
  assert.equal(fu.parentTaskId, t.id);
  assert.equal(fu.employeeId, "marketing");
  const prompt = ms.getManualPrompt(db, fu.id);
  assert.match(prompt, /이전 결과물/);
  assert.match(prompt, /원본문구ABC/);
  assert.match(prompt, /더 짧게/);
  svc.requestCancel(db, fu.id);
});

test("forward hands the report to another employee", () => {
  const r = rep.actOnReport(db, reportId, { action: "FORWARD", targetEmployeeId: "sales", note: "영업 DM으로", executionMode: "manual" });
  const fu = svc.getTask(db, r.createdTaskId!)!;
  assert.equal(fu.employeeId, "sales");
  assert.match(ms.getManualPrompt(db, fu.id), /유나 작성/);
  svc.requestCancel(db, fu.id);
});

test("apply to project updates the project; approve and close are logged", () => {
  rep.actOnReport(db, reportId, { action: "APPLY_TO_PROJECT", executionMode: "manual", project: { id: "number-maze", stage: "기획", nextPlan: "홍보 문구 확정" } });
  const p = db.select().from(s.projects).where(eq(s.projects.id, "number-maze")).get()!;
  assert.equal(p.stage, "기획");
  assert.equal(p.nextPlan, "홍보 문구 확정");
  rep.actOnReport(db, reportId, { action: "APPROVED", executionMode: "manual" });
  const r = rep.actOnReport(db, reportId, { action: "CLOSE", note: "끝", executionMode: "manual" });
  assert.deepEqual(r.decisions.map((d) => d.decision), ["CLOSE", "APPROVED", "APPLY_TO_PROJECT", "FORWARD", "REVISION"]);
  const ev = db.select().from(s.taskEvents).all().filter((e) => e.type === "DECISION_RECORDED");
  assert.equal(ev.length, 5);
  assert.equal(svc.getReport(db, reportId)!.decisions.length, 5);
});
