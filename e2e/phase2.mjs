// PHASE 2 end-to-end: the first real-task scenario (STEP 1-14) through the browser.
// Starts its own web server (built app), worker and the TEST-ONLY mock Anthropic API on a temp DB.
//   npm run build && node e2e/phase2.mjs
// Part A: no API key → the task must FAIL visibly (no fake report).
// Part B: mock API → full pipeline: DB → worker → SSE → character → report → reload.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = path.join(ROOT, "e2e/out/");
fs.mkdirSync(OUT, { recursive: true });
const PORT = 3123;
const MOCK = 4320;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aico-e2e-")), "e2e.db");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const procs = [];
function start(args, env) {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, DATABASE_PATH: DB, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  p.stdout.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  p.stderr.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  procs.push(p);
  return p;
}
async function waitHttp(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout ${url}`);
}
const workerArgs = ["--import", "tsx", "worker/index.ts"];
async function waitWorker(alive = true) {
  for (let i = 0; i < 60; i++) {
    const h = await (await fetch(`${BASE}/api/health`)).json();
    if (h.worker.running === alive) return h;
    await sleep(500);
  }
  throw new Error("worker state timeout");
}

try {
  // ~25 s per report, closer to a real Claude call than the unit-test default
  start(["e2e/mock-anthropic.mjs", String(MOCK)], { MOCK_CHUNK_MS: "1300" });
  start([path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { ANTHROPIC_API_KEY: "" });
  await waitHttp(`http://127.0.0.1:${MOCK}/health`);
  if (procs[0].exitCode !== null) throw new Error(`mock port ${MOCK} already in use`);
  await waitHttp(`${BASE}/api/health`);

  // ── Part A: worker without an API key ─────────────────────────────
  let worker = start(workerArgs, { ANTHROPIC_API_KEY: "" });
  const hA = await waitWorker(true);
  check("실행기 연결 감지 (heartbeat)", hA.worker.running === true);
  check("API 키 없음 상태가 정직하게 표시됨", hA.ai.keyConfigured === false);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  globalThis.__pages = [page];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => {
    errors.push(`dialog opened: ${d.message()}`);
    d.dismiss();
  });
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.__officeTest[f](...args), [fn, a]);
  const actor = async (id) => (await T("actors")).find((a) => a.id === id);
  const clickEmployee = async (id) => {
    const box = await page.locator("[data-testid=office-canvas] canvas").boundingBox();
    const p = await T("screenPos", id);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  const order = async (text) => {
    const panel = page.locator("aside");
    await panel.getByRole("button", { name: "업무 지시", exact: true }).first().click();
    await panel.getByRole("radio", { name: /API 자동/ }).check();
    await page.fill("#order-text", text);
    await page.selectOption("#order-project", "number-maze");
    await panel.getByRole("button", { name: "업무 지시하기" }).click();
  };

  await page.goto(`${BASE}/?test=1`);
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  await page.getByText("실시간", { exact: true }).waitFor({ timeout: 10000 });
  check("상단 바: AI 키 없음 표시", (await page.locator("header").innerText()).includes("API 키 없음"));

  await clickEmployee("validator");
  await page.locator("aside").getByRole("button", { name: "업무 지시", exact: true }).first().click();
  const apiRadio = page.locator("aside").getByRole("radio", { name: /API 자동/ });
  check("키가 없으면 'API 자동'은 선택 불가, 무료 방식이 기본", (await apiRadio.isDisabled()) && (await page.locator("aside").getByRole("radio", { name: /붙여넣기/ }).isChecked()));
  await page.locator("aside").getByRole("button", { name: "정보" }).click();
  // An API-mode task created directly (e.g. by a script) must still fail honestly without a key.
  await fetch(`${BASE}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: "validator", instruction: "키 없이 실행하면 어떻게 되는지 확인", executionMode: "api" }) });
  await page.locator("[data-testid=failed-task]").waitFor({ timeout: 30000 });
  const failText = await page.locator("[data-testid=failed-task]").innerText();
  check("키 없음 → 업무 FAILED, 실제 사유 표시", failText.includes("ANTHROPIC_API_KEY"));
  await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "error", null, { timeout: 20000 });
  check("실패 시 캐릭터 오류 애니메이션", true);
  check("실패 알림 표시", await page.getByText("실패", { exact: true }).first().isVisible());
  const officeA = await (await fetch(`${BASE}/api/office`)).json();
  check("실패 업무에 보고서 없음 (가짜 결과 없음)", officeA.recentCompleted.length === 0 && officeA.attention.some((t) => t.status === "FAILED"));
  await page.screenshot({ path: OUT + "p2-01-no-key-failed.png" });

  // ── Part B: worker with the TEST-ONLY mock API ─────────────────────
  worker.kill("SIGTERM");
  await waitWorker(false);
  worker = start(workerArgs, { ANTHROPIC_API_KEY: "test-key-not-real", ANTHROPIC_BASE_URL: `http://127.0.0.1:${MOCK}` });
  await waitWorker(true);
  await page.reload();
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  await sleep(1000);

  // STEP 4-6: click Business Validator, enter the task, it is saved
  // Send the validator to the lounge first (animation preview) so the walk to the desk is visible.
  await clickEmployee("validator");
  await page.evaluate(() => { const d = document.querySelector("aside details"); if (d) d.open = true; });
  await page.locator("aside").getByRole("button", { name: "휴식 중", exact: true }).click();
  await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "resting", null, { timeout: 40000 });
  const before = await actor("validator");
  await order("Number Maze라는 퍼즐 게임의 수익화 전략을 분석하고 장단점을 보고서로 작성해줘.");
  await sleep(300);
  const office1 = await (await fetch(`${BASE}/api/office`)).json();
  const task = office1.byEmployee.validator.activeTask;
  check("STEP 6 업무가 DB에 저장됨", !!task, task ? `${task.id} ${task.status}` : "none");

  // STEP 7-9: walks to the desk and works while the server reports RUNNING
  await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "working", null, { timeout: 30000 });
  const working = await actor("validator");
  const deskTile = { x: 35, y: 7 };
  check("STEP 7 캐릭터가 자기 책상으로 이동", Math.floor(working.x / 16) === deskTile.x && Math.floor(working.y / 16) === deskTile.y, `from ${Math.floor(before.x / 16)},${Math.floor(before.y / 16)}`);
  const running = (await (await fetch(`${BASE}/api/tasks/${task.id}`)).json()).task;
  check("STEP 8 서버에서 실제 실행 중 (RUNNING)", ["PLANNING", "RUNNING"].includes(running.status), running.status);
  check("STEP 9 작업 애니메이션 + 모니터 점등", await T("screenLit", "desk-research-1"));
  await page.locator("[data-testid=active-task]").waitFor();
  check("진행 중 업무 카드에 서버 상태 표시", (await page.locator("[data-testid=active-task]").innerText()).includes("실제 실행 중"));
  await page.screenshot({ path: OUT + "p2-02-working.png" });

  // STEP 10-12: report saved, character reports, CEO notified
  await page.getByRole("button", { name: "보고서 열기" }).waitFor({ timeout: 60000 });
  check("완료 알림 (보고서 열기 버튼)", true);
  const done = (await (await fetch(`${BASE}/api/tasks/${task.id}`)).json());
  check("STEP 10-11 보고서 생성·DB 저장", done.task.status === "COMPLETED" && !!done.report, done.report?.id);
  check("비용·토큰 사용량 기록", done.usage.input === 1200 && done.usage.output === 900, `$${(done.usage.micros / 1e6).toFixed(4)} (추정)`);
  await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "reporting", null, { timeout: 30000 });
  const rep = await actor("validator");
  check("STEP 12 대표실로 가서 보고 애니메이션", Math.floor(rep.x / 16) <= 12 && Math.floor(rep.y / 16) <= 14, `tile ${Math.floor(rep.x / 16)},${Math.floor(rep.y / 16)}`);
  const log = await page.locator("[data-testid=event-log]").innerText();
  check("실시간 업무 로그 (SSE)", ["TASK_CREATED", "TASK_STARTED", "TASK_PROGRESS", "TASK_COMPLETED"].every((t) => log.includes(t)));
  await page.screenshot({ path: OUT + "p2-03-reporting.png" });

  // STEP 13: open the report
  await page.locator("aside").getByRole("button", { name: "보고서", exact: true }).first().click();
  const modal = page.getByRole("dialog", { name: "결과 보고서" });
  await modal.locator("article h2").first().waitFor();
  const body = await modal.innerText();
  check("STEP 13 보고서 열람 (마크다운 렌더링)", body.includes("요약") && (await modal.locator("article table").count()) === 1);
  check("보고서 내 스크립트 차단 (XSS 방어)", (await modal.locator("article script").count()) === 0);
  check("웹 검색 미사용이 출처 칸에 명시", body.includes("웹 검색을 사용하지 않았습니다"));
  await page.screenshot({ path: OUT + "p2-04-report.png" });
  await page.keyboard.press("Escape");

  // STEP 14: reload keeps history and report
  await page.reload();
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  await sleep(800);
  await clickEmployee("validator");
  const panelText = await page.locator("aside").innerText();
  check("STEP 14 새로고침 후 업무 기록·보고서 유지", panelText.includes("Number Maze라는 퍼즐") && panelText.includes("보고서 1건"));
  await page.locator("aside").getByRole("button", { name: "보고서", exact: true }).first().click();
  await modal.locator("article h2").first().waitFor();
  check("새로고침 후 보고서 다시 열림", (await modal.innerText()).includes("요약"));
  await page.keyboard.press("Escape");

  // Cancel a running task
  await clickEmployee("marketing");
  await order("MOCK_SLOW 취소 테스트");
  await page.locator("[data-testid=active-task]").getByText("실제 실행 중").waitFor({ timeout: 30000 });
  await page.locator("[data-testid=active-task]").getByRole("button", { name: "업무 취소" }).click();
  await page.waitForFunction(async () => {
    const r = await fetch("/api/office").then((r) => r.json());
    return r.byEmployee.marketing.lastFinished?.status === "CANCELED";
  }, null, { timeout: 30000, polling: 500 });
  check("실행 중 업무 취소 → CANCELED", true);

  // Game speed must not speed up the server
  check("콘솔 오류·대화상자 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
} catch (e) {
  check("시나리오 실행", false, e.message);
  try {
    const pages = (globalThis.__pages ?? []);
    for (const pg of pages) {
      const st = await pg.evaluate(() => window.__officeTest?.actors().find((a) => a.id === "validator"));
      console.log("DEBUG actor", JSON.stringify(st));
    }
    const o = await (await fetch(`${BASE}/api/office`)).json();
    console.log("DEBUG task", JSON.stringify(o.byEmployee.validator.activeTask ?? o.byEmployee.validator.lastFinished));
  } catch (x) { console.log("debug failed", x.message); }
} finally {
  for (const p of procs) p.kill("SIGTERM");
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
