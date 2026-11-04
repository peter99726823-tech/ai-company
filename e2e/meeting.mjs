// Meeting + free (paste) mode, end to end in the browser. No API key needed.
//   npm run build && node e2e/meeting.mjs
// The "claude.ai answer" pasted here is a TEST string written by this script, clearly marked as such.
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
const PORT = 3124;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aico-meet-")), "m.db");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const procs = [];
const start = (args, env) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, DATABASE_PATH: DB, ANTHROPIC_API_KEY: "", ...env }, stdio: "ignore" });
  procs.push(p);
  return p;
};
async function waitHttp(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error(`timeout ${url}`);
}
const ROOM = { x0: 17, y0: 21, x1: 30, y1: 38 };
const NAME = { "ceo-advisor": "한결", validator: "서진", cto: "도윤", marketing: "유나", pricing: "하린" };
const testAnswer = (ids) =>
  ids.map((id) => `=== 부서: ${id} | ${NAME[id]} ===\n[테스트 문구] ${NAME[id]}의 의견: 작게 검증하자는 입장입니다. 근거와 위험을 정리했습니다.`).join("\n\n") +
  "\n\n=== 종합: CEO Advisor ===\n## 회의 요약\n[테스트 문구] 부서 의견을 종합했습니다.\n## 대표 결정 선택지\n- [A] 2주 MVP 검증\n- [B] 보류\n## 후속 업무 제안\n- 담당: cto | 업무: MVP 범위를 1주 분량으로 정리\n- 담당: marketing | 업무: 테스트 사용자 모집 문구 작성\n";

try {
  start([path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], {});
  start(["--import", "tsx", "worker/index.ts"], {});
  await waitHttp(`${BASE}/api/health`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.__officeTest[f](...args), [fn, a]);
  await page.goto(`${BASE}/?test=1`);
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  await page.getByText("실시간", { exact: true }).waitFor({ timeout: 15000 });

  // 1. 회의 소집
  await page.getByRole("button", { name: "회의 소집" }).click();
  const dlg = page.getByRole("dialog", { name: "회의 소집" });
  await page.fill("#meeting-topic", "Number Maze를 계속 개발할지, AI 맞춤형 솔루션 영업에 집중할지");
  await page.selectOption("#meeting-project", "number-maze");
  check("키가 없으면 무료(붙여넣기) 방식이 기본 선택", await dlg.getByRole("radio").first().isChecked());
  await dlg.getByRole("button", { name: "회의 시작" }).click();
  const room = page.getByRole("dialog", { name: "회의실" });
  await room.locator("[data-testid=manual-run]").waitFor({ timeout: 15000 });
  check("회의 생성 → 회의실 창에 붙여넣기 단계 표시", true);

  // 2. participants walk to the meeting room
  const ids = ["validator", "cto", "marketing", "pricing", "ceo-advisor"];
  await page.waitForFunction(
    (ids) => ids.every((id) => { const a = window.__officeTest.actors().find((x) => x.id === id); return !a.moving && (a.activity === "meeting" || a.activity === "waiting"); }),
    ids,
    { timeout: 60000 },
  );
  const actors = await T("actors");
  const inRoom = ids.every((id) => {
    const a = actors.find((x) => x.id === id);
    const tx = Math.floor(a.x / 16), ty = Math.floor(a.y / 16);
    return tx >= ROOM.x0 && tx <= ROOM.x1 && ty >= ROOM.y0 && ty <= ROOM.y1;
  });
  check("참석자 5명이 회의실로 이동해 착석", inRoom);
  check("CEO Advisor가 '붙여넣기 대기' 말풍선", (actors.find((a) => a.id === "ceo-advisor").bubble ?? "").includes("붙여넣어"));
  await room.press("Escape").catch(() => {});
  await page.screenshot({ path: OUT + "m-01-gathered.png" });

  // 3. prompt contents
  const prompt = await room.locator("textarea[readonly]").inputValue();
  check("지시문에 주제·참석자·형식 포함", prompt.includes("Number Maze를 계속") && prompt.includes("PARTICIPANTS: validator,cto,marketing,pricing,ceo-advisor") && prompt.includes("=== 종합: CEO Advisor ==="));
  check("지시문에 프로젝트 정보 자동 포함", prompt.includes("숫자 경로 기반 퍼즐 게임"));

  // 4. a broken paste is rejected
  await room.locator("textarea:not([readonly])").fill(testAnswer(["validator", "cto"]));
  await room.getByRole("button", { name: "회의록 제출" }).click();
  await room.getByText("발언이 답변에 없습니다").waitFor({ timeout: 10000 });
  check("참석자가 빠진 답변은 거부 (빈칸을 지어내지 않음)", true);

  // 5. full paste
  await room.locator("textarea:not([readonly])").fill(testAnswer(ids));
  await room.getByRole("button", { name: "회의록 제출" }).click();
  await room.locator("[data-testid=statements] article").first().waitFor({ timeout: 15000 });
  check("부서별 발언 5개 표시", (await room.locator("[data-testid=statements] article").count()) === 5);
  check("CEO 종합과 결정 선택지 표시", (await room.getByText("2주 MVP 검증").count()) > 0);
  await page.screenshot({ path: OUT + "m-02-minutes.png" });

  // 6. playback: speakers' real statements appear as bubbles in order
  await page.waitForFunction(() => (window.__officeTest.actors().find((a) => a.id === "validator").bubble ?? "").includes("서진의 의견"), null, { timeout: 15000 });
  check("회의 연출: 첫 발언자 말풍선 = 실제 발언 첫 문장", true);
  await page.waitForFunction(() => (window.__officeTest.actors().find((a) => a.id === "cto").bubble ?? "").includes("도윤의 의견"), null, { timeout: 15000 });
  check("회의 연출: 다음 발언자로 차례 이동", true);
  await room.getByRole("button", { name: "닫기" }).click();
  await page.screenshot({ path: OUT + "m-03-speaking.png" });

  // 7. decision → follow-up
  await page.getByRole("button", { name: "회의록", exact: true }).first().click();
  const room2 = page.getByRole("dialog", { name: "회의실" });
  await room2.locator("[data-testid=decision]").waitFor();
  await room2.getByRole("radio").first().check();
  check("후속 업무는 기본으로 모두 체크", (await room2.getByRole("checkbox").count()) === 2 && (await room2.getByRole("checkbox").nth(1).isChecked()));
  await room2.getByRole("checkbox").nth(1).uncheck(); // keep only 도윤's
  await room2.getByRole("button", { name: "결정 기록" }).click();
  await room2.getByText("후속 업무 1건을 등록했습니다").waitFor({ timeout: 10000 });
  const office = await (await fetch(`${BASE}/api/office`)).json();
  const fu = office.byEmployee.cto.activeTask;
  check("결정 기록 → 도윤에게 후속 업무 등록", !!fu && fu.instruction.includes("MVP 범위") && fu.executionMode === "manual");
  check("결정이 이벤트 로그에 기록", office.recentEvents.some((e) => e.type === "DECISION_RECORDED"));
  await room2.getByRole("button", { name: "닫기" }).click();

  // 8. reload persists
  await page.reload();
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  await page.getByRole("button", { name: "회의록", exact: true }).first().click();
  const room3 = page.getByRole("dialog", { name: "회의실" });
  await room3.locator("[data-testid=statements] article").first().waitFor();
  check("새로고침 후 회의록·결정 유지", (await room3.locator("[data-testid=decision]").innerText()).includes("결정함"));
  await room3.getByRole("button", { name: "닫기" }).click();

  // 9. single task in free mode
  const box = await page.locator("[data-testid=office-canvas] canvas").boundingBox();
  const p = await T("screenPos", "sales");
  await page.mouse.click(box.x + p.x, box.y + p.y);
  const panel = page.locator("aside");
  await panel.getByRole("button", { name: "업무 지시", exact: true }).first().click();
  await page.fill("#order-text", "AI 맞춤형 솔루션 첫 고객에게 보낼 DM 초안 3개");
  await panel.getByRole("button", { name: "업무 지시하기" }).click();
  const mm = page.getByRole("dialog", { name: "업무 처리" });
  await mm.locator("[data-testid=manual-run]").waitFor({ timeout: 10000 });
  await mm.locator("textarea:not([readonly])").fill("## 요약\n[테스트 문구] DM 초안 3개를 작성했습니다. 고객 문제에서 출발했습니다.\n## 결과물\n1. 안녕하세요...\n");
  await mm.getByRole("button", { name: "보고서 제출" }).click();
  await mm.waitFor({ state: "detached", timeout: 10000 });
  const o2 = await (await fetch(`${BASE}/api/office`)).json();
  check("개별 업무도 붙여넣기로 보고서 저장", o2.byEmployee.sales.recentCompleted[0]?.reportId != null);
  check("붙여넣기 방식은 API 비용 0", o2.todayCost.calls === 0);
  check("콘솔 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
  await browser.close();
} catch (e) {
  check("시나리오 실행", false, e.message.split("\n")[0]);
} finally {
  for (const p of procs) p.kill("SIGTERM");
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
