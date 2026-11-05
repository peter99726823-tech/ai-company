/** Work view: routing, project memory in prompts, duplicate guard, search, board, usage. No AI calls. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aico-w-"));
process.env.DATABASE_PATH = path.join(dir, "w.db");

const { getDb } = await import("../src/server/db/client");
const svc = await import("../src/server/tasks/service");
const ms = await import("../src/server/meetings/service");
const complete = await import("../src/server/tasks/complete");
const work = await import("../src/server/work/service");
const { routeTask } = await import("../src/domain/routing");
const s = await import("../src/server/db/schema");
const db = getDb();

test("routing: keywords pick the right person, names win, and nothing matched goes to 한결", () => {
  assert.equal(routeTask("공모전 기획서 목차 잡아줘").employeeId, "planner");
  assert.equal(routeTask("백테스트용 데이터 수집 계획").employeeId, "ai-engineer");
  assert.equal(routeTask("출시 전 QA 점검표와 버그 목록").employeeId, "frontend");
  assert.equal(routeTask("구독 가격과 손익분기 계산").employeeId, "pricing");
  assert.equal(routeTask("인스타 홍보 콘텐츠 5개").employeeId, "marketing");
  assert.equal(routeTask("외주 계약서 위약금 조항 봐줘").employeeId, "contract");
  assert.equal(routeTask("준서에게 이 내용 정리 부탁").employeeId, "ai-engineer");
  const none = routeTask("음");
  assert.equal(none.employeeId, "ceo-advisor");
  assert.match(none.reason, /한결/);
});

test("project memory: decisions and recent results go into the next prompt, bounded", () => {
  const m = ms.createMeeting(db, { topic: "# [회의 안건] 메모리 테스트\n본문", participantIds: ["validator", "cto"], projectId: "number-maze", executionMode: "manual" });
  const ids = m.participants.map((p) => p.employeeId);
  const ans = ids.map((id) => `=== 부서: ${id} | x ===\n${id} 의견입니다. 충분히.`).join("\n") + "\n=== 종합: CEO Advisor ===\n## 회의 요약\n메모리 테스트 요약입니다. 충분히 깁니다.\n## 대표 결정 선택지\n- [A] MEMORY 모드로 간다\n";
  ms.submitManualAnswer(db, m.task!.id, ans);
  ms.decideMeeting(db, m.meeting.id, { option: "[A] MEMORY 모드로 간다", followUps: [], executionMode: "manual" });
  const t = svc.createTask(db, { employeeId: "marketing", instruction: "출시 문구 써 줘", projectId: "number-maze", executionMode: "manual" });
  const { user } = complete.buildPrompts(db, t, false);
  assert.ok(user.includes("이 프로젝트의 기억"), "memory section present");
  assert.ok(user.includes("MEMORY 모드로 간다"), "the CEO's decision is carried");
  assert.ok(user.includes("메모리 테스트 요약입니다"), "recent result summary is carried");
  assert.ok(work.projectMemory(db, "number-maze", { maxChars: 200 }).length <= 220, "bounded");
  assert.equal(work.projectMemory(db, null), "");
  svc.requestCancel(db, t.id);
});

test("duplicate guard: the same open instruction to the same person is refused; after cancel it is allowed", () => {
  const a = svc.createTask(db, { employeeId: "ops", instruction: "주간 계획표", executionMode: "manual" });
  assert.throws(() => svc.createTask(db, { employeeId: "ops", instruction: "주간 계획표", executionMode: "manual" }), /이미 진행 중/);
  svc.createTask(db, { employeeId: "planner", instruction: "주간 계획표", executionMode: "manual" }); // different person is fine
  svc.requestCancel(db, a.id);
  const b = svc.createTask(db, { employeeId: "ops", instruction: "주간 계획표", executionMode: "manual" });
  assert.ok(b.id);
});

test("results search, work board and usage summary", () => {
  const found = work.searchReports(db, { q: "메모리 테스트" });
  assert.ok(found.length >= 1 && found[0].summary.includes("메모리 테스트"));
  assert.equal(work.searchReports(db, { q: "없는단어XYZ" }).length, 0);
  const board = work.workBoard(db);
  assert.ok(board.active.some((t) => t.title === "주간 계획표"));
  db.insert(s.apiUsage).values({ id: "u1", taskId: board.active[0].id, model: "m", inputTokens: 10, outputTokens: 5, costMicros: 120000, priceTableVersion: "t" }).run();
  const u = work.usageSummary(db);
  assert.equal(u.today.calls, 1);
  assert.ok(Math.abs(u.today.usd - 0.12) < 1e-9);
  assert.equal(u.byDay.length, 14);
  assert.ok(u.byEmployee.length >= 1);
});
