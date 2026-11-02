// Link version (lite/dist/index.html) in a real browser: meeting + paste + decision + persistence.
//   node lite/build.mjs && node e2e/lite.mjs
// Served over a local HTTP server, outside claude.ai, so it uses localStorage persistence.
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = path.join(ROOT, "e2e/out/");
const page0 = fs.readFileSync(path.join(ROOT, "lite/dist/index.html"), "utf8");
const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${page0}</body></html>`;
const server = http.createServer((_q, r) => (r.writeHead(200, { "content-type": "text/html; charset=utf-8" }), r.end(html))).listen(4455);
const results = [];
const check = (n, ok, d = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`));
const NAME = { "ceo-advisor": "한결", validator: "서진", cto: "도윤", marketing: "유나", pricing: "하린" };
const answer = (ids) =>
  ids.map((id) => `=== 부서: ${id} | ${NAME[id]} ===\n[테스트 문구] ${NAME[id]}의 의견입니다. 근거와 대안.`).join("\n\n") +
  "\n\n=== 종합: CEO Advisor ===\n## 회의 요약\n[테스트 문구] 종합했습니다. 충분히 깁니다.\n## 대표 결정 선택지\n- [A] 진행\n- [B] 보류\n## 후속 업무 제안\n- 담당: cto | 업무: 범위 정리\n";

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("http://localhost:4455/?test=1");
  await page.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
  check("링크 버전 열림 (서버 없이)", await page.locator("canvas").isVisible());
  check("상단 바: 붙여넣기 모드 표시", (await page.locator("header").innerText()).includes("붙여넣기 모드"));
  await page.getByTestId("save-state").getByText("저장됨").waitFor({ timeout: 10000 });
  check("첫 방문 기록 자동 저장", true);

  await page.getByRole("button", { name: "회의 소집" }).click();
  await page.fill("#meeting-topic", "링크 버전 테스트 회의");
  const dlg = page.getByRole("dialog", { name: "회의 소집" });
  check("API 자동은 선택 불가", await dlg.getByRole("radio").nth(1).isDisabled());
  await dlg.getByRole("button", { name: "회의 시작" }).click();
  const room = page.getByRole("dialog", { name: "회의실" });
  await room.locator("[data-testid=manual-run]").waitFor();
  await page.waitForFunction(() => (document.querySelector("[role=dialog] textarea[readonly]")?.value ?? "").includes("PARTICIPANTS"), null, { timeout: 10000 });
  const prompt = await room.locator("textarea[readonly]").inputValue();
  const ids = /PARTICIPANTS: ([a-z,-]+)/.exec(prompt)[1].split(",");
  check("회의 지시문 생성", prompt.includes("링크 버전 테스트 회의") && ids.length === 5);
  await room.locator("textarea:not([readonly])").fill(answer(ids));
  await room.getByRole("button", { name: "회의록 제출" }).click();
  await room.locator("[data-testid=statements] article").first().waitFor({ timeout: 10000 });
  check("부서별 발언 저장·표시", (await room.locator("[data-testid=statements] article").count()) === 5);
  await room.getByRole("radio").first().check();
  await room.getByRole("checkbox").first().check();
  await room.getByRole("button", { name: "결정 기록" }).click();
  await room.getByText("후속 업무 1건").waitFor();
  check("결정 → 후속 업무 등록", true);
  await room.getByRole("button", { name: "닫기" }).click();
  await page.waitForFunction(() => document.querySelector("[data-testid=save-state]")?.textContent?.includes("저장됨"), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "lite-01.png" });

  await page.reload();
  await page.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
  await page.getByRole("button", { name: "회의록" }).first().click();
  const room2 = page.getByRole("dialog", { name: "회의실" });
  await room2.locator("[data-testid=statements] article").first().waitFor({ timeout: 10000 });
  check("새로고침 후 회의록·결정 유지", (await room2.locator("[data-testid=decision]").innerText()).includes("결정함"));
  const office = await page.evaluate(() => fetch("/api/office").then((r) => r.json()));
  check("새로고침 후 후속 업무 유지", office.byEmployee.cto.activeTask?.instruction.includes("범위 정리"));
  await room2.getByRole("button", { name: "닫기" }).click();

  // ── 1:1 chat (paste mode) ──
  const T = (fn, ...a) => page.evaluate(([f, args]) => window.__officeTest[f](...args), [fn, a]);
  const clickEmployee = async (id) => {
    const box = await page.locator("canvas").boundingBox();
    const p = await T("screenPos", id);
    await page.mouse.click(box.x + p.x, box.y + p.y);
  };
  await clickEmployee("validator");
  await page.locator("aside").getByRole("button", { name: "대화하기" }).click();
  const chatDlg = page.getByRole("dialog", { name: /서진와 대화/ });
  await chatDlg.waitFor({ timeout: 10000 });
  await page.fill("#chat-text", "Number Maze 차별점이 뭐라고 봐?");
  await chatDlg.getByRole("button", { name: "보내기" }).click();
  await chatDlg.locator("[data-testid=manual-run]").waitFor({ timeout: 10000 });
  await page.waitForFunction(() => (document.querySelector("[aria-label='서진와 대화'] textarea[readonly]")?.value ?? "").includes("1:1로 대화"), null, { timeout: 10000 });
  check("대화: 메시지 → 대화용 지시문 생성", true);
  await chatDlg.locator("[data-testid=manual-run] textarea:not([readonly])").fill("[테스트 문구] 복기 기능이 차별점이 될 수 있습니다.");
  await chatDlg.getByRole("button", { name: "답변 넣기" }).click();
  await chatDlg.locator("[data-role=employee]").first().waitFor({ timeout: 10000 });
  check("대화: 붙여넣은 답변이 대화에 표시", (await chatDlg.locator("[data-role=employee]").innerText()).includes("복기 기능"));
  await chatDlg.getByRole("button", { name: "닫기" }).click();

  // ── report decision: revision → linked follow-up ──
  await page.evaluate(async () => {
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: "marketing", instruction: "출시 홍보 문구 써줘" }) });
    const t = (await r.json()).task;
    await fetch(`/api/tasks/${t.id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "## 요약\n[테스트 문구] 홍보 문구 초안입니다. 충분히 긴 본문입니다.\n## 결과물\n원본문구XYZ" }) });
  });
  await page.waitForTimeout(500);
  await clickEmployee("marketing");
  await page.locator("aside").getByRole("button", { name: "보고서", exact: true }).first().click();
  const rm = page.getByRole("dialog", { name: "결과 보고서" });
  await rm.locator("[data-testid=report-actions]").waitFor({ timeout: 10000 });
  await rm.getByRole("button", { name: "수정 요청" }).click();
  await rm.locator("[data-testid=report-actions] textarea").fill("더 짧고 강하게");
  await rm.getByRole("button", { name: "수정 요청 확정" }).click();
  await rm.getByText("후속 업무를 등록했습니다").waitFor({ timeout: 10000 });
  check("보고서 수정 요청 → 후속 업무 등록·이력 표시", (await rm.locator("[data-testid=report-history]").innerText()).includes("더 짧고 강하게"));
  const fuPrompt = await page.evaluate(async () => {
    const o = await fetch("/api/office").then((r) => r.json());
    const t = o.byEmployee.marketing.activeTask;
    return (await fetch(`/api/tasks/${t.id}/prompt`).then((r) => r.json())).prompt;
  });
  check("후속 업무 지시문에 이전 보고서 자동 첨부", fuPrompt.includes("원본문구XYZ") && fuPrompt.includes("더 짧고 강하게"));
  await rm.getByRole("button", { name: "프로젝트에 반영" }).click();
  await rm.getByLabel("반영할 프로젝트").selectOption("draw-quest");
  await rm.getByPlaceholder("다음 실행 계획").fill("홍보 문구 확정");
  await rm.getByRole("button", { name: "프로젝트에 반영 확정" }).click();
  await rm.getByText("프로젝트에 반영 기록했습니다").waitFor();
  const proj = await page.evaluate(() => fetch("/api/office").then((r) => r.json()).then((o) => o.projects.find((p) => p.id === "draw-quest")));
  check("보고서 → 프로젝트 반영", proj.nextPlan === "홍보 문구 확정");
  await page.screenshot({ path: OUT + "lite-02-report-actions.png" });

  check("콘솔 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("시나리오 실행", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
