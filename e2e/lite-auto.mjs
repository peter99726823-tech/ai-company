// Link version "Claude 자동": window.claude.use("sample") is SIMULATED here (TEST ONLY) — the real one
// exists only inside claude.ai. Checks: auto option shown, meeting written + saved without pasting,
// paste box live check, error path, and top bar not clipped at narrow widths.
//   node lite/build.mjs && node e2e/lite-auto.mjs
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = path.join(ROOT, "e2e/out/");
fs.mkdirSync(OUT, { recursive: true });
const page0 = fs.readFileSync(path.join(ROOT, "lite/dist/index.html"), "utf8");
const html = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"></head><body>${page0}</body></html>`;
const server = http.createServer((_q, r) => (r.writeHead(200, { "content-type": "text/html; charset=utf-8" }), r.end(html))).listen(4457);
const results = [];
const check = (n, ok, d = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`));

// Fake `sample`: answers in the meeting format for whoever is in PARTICIPANTS, streaming in pieces.
const fake = (mode) => `
  window.__sampleCalls = 0;
  const sample = async (input, opts = {}) => {
    window.__sampleCalls++;
    if (${JSON.stringify(mode)} === "deny") throw { code: "not_granted", message: "denied" };
    const ids = /PARTICIPANTS: ([a-z,-]+)/.exec(input)[1].split(",");
    const full = ids.map((id) => "=== 부서: " + id + " | x ===\\n[테스트 문구] " + id + " 의견입니다. 근거와 대안.").join("\\n\\n") +
      "\\n\\n=== 종합: CEO Advisor ===\\n## 회의 요약\\n[테스트 문구] 자동 종합입니다. 충분히 깁니다.\\n## 대표 결정 선택지\\n- [A] 진행\\n- [B] 보류\\n## 후속 업무 제안\\n- 담당: cto | 업무: 범위 정리\\n";
    let text = "";
    for (const part of full.match(/[\\s\\S]{1,60}/g)) {
      await new Promise((r) => setTimeout(r, 15));
      text += part; opts.onText && opts.onText({ text, delta: part });
    }
    return { text, truncated: false };
  };
  window.claude = { use: async (n) => (n === "sample" ? sample : null) };
`;

const browser = await chromium.launch();
try {
  // ── auto meeting ──
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(fake("ok"));
  await page.goto("http://localhost:4457/");
  await page.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
  await page.locator("header").getByText("Claude 자동").waitFor({ timeout: 5000 }).catch(() => {});
  check("상단: Claude 자동 표시", (await page.locator("header").innerText()).includes("Claude 자동"));
  await page.getByRole("button", { name: "회의 소집" }).click();
  const dlg = page.getByRole("dialog", { name: "회의 소집" });
  const auto = dlg.getByRole("radio").first();
  check("회의 소집: Claude 자동이 기본 선택", await auto.isChecked());
  await page.fill("#meeting-topic", "자동 회의 테스트");
  await dlg.getByRole("button", { name: /회의 시작/ }).click();
  const room = page.getByRole("dialog", { name: "회의실" });
  await room.locator("[data-testid=statements] article").first().waitFor({ timeout: 20000 }).catch(async () => {
    await page.screenshot({ path: OUT + "lite-auto-fail.png" });
    console.log("DEBUG", await room.innerText());
  });
  check("붙여넣기 없이 부서별 발언 저장", (await room.locator("[data-testid=statements] article").count()) === 5);
  check("Claude 호출은 한 번", (await page.evaluate(() => window.__sampleCalls)) === 1);
  check("결정 선택지 표시", (await room.getByRole("radio").count()) === 2);
  await room.getByRole("button", { name: "닫기" }).click();

  // ── manual paste box with live check ──
  await page.getByRole("button", { name: "회의 소집" }).click();
  await page.fill("#meeting-topic", "붙여넣기 테스트");
  await dlg.getByRole("radio").nth(1).check();
  await dlg.getByRole("button", { name: /회의 시작/ }).click();
  await room.getByTestId("answer-box").waitFor();
  await page.waitForTimeout(400);
  check("붙여넣기 방식은 자동 실행 안 함", (await page.evaluate(() => window.__sampleCalls)) === 1);
  const box = room.getByTestId("answer-box");
  const h = (await box.locator("textarea").boundingBox()).height;
  check("답변 칸이 큼", h >= 220, `${Math.round(h)}px`);
  await box.locator("textarea").fill("=== 부서: ceo-advisor | 한결 ===\n의견\n=== 부서: cto | 도윤 ===\n의견");
  const chips = await box.innerText();
  check("실시간 확인: 들어온 부서 ✓ 표시", chips.includes("✓ 한결") && chips.includes("✓ 도윤") && chips.includes("· 서진"));
  check("빠진 부서 경고", chips.includes("빠진 부서가 있으면"));
  await page.screenshot({ path: OUT + "lite-auto-paste.png" });
  await room.getByRole("button", { name: "닫기" }).click();
  await page.close();

  // ── paste an answer the CEO already has, straight from the meeting dialog ──
  {
    const p3 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p3.goto("http://localhost:4457/");
    await p3.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
    await p3.getByRole("button", { name: "회의 소집" }).click();
    const d3 = p3.getByRole("dialog", { name: "회의 소집" });
    await d3.getByRole("tab", { name: /받은 답변 바로 붙여넣기/ }).click();
    const save = d3.getByRole("button", { name: "회의록으로 저장" });
    await p3.fill("#meeting-paste", "=== 부서: cto | 도윤 ===\n의견만 있음");
    check("붙여넣기 탭: 종합 없으면 저장 버튼 꺼짐", await save.isDisabled());
    const answer = fs.readFileSync(path.join(ROOT, "e2e/fixtures-meeting-answer.txt"), "utf8");
    await p3.fill("#meeting-paste", answer);
    check("붙여넣기 탭: 부서 9개 자동 인식", (await d3.getByTestId("paste-answer").innerText()).includes("찾은 부서 9개"));
    await p3.fill("#meeting-topic", "Number Maze MEMORY 모드 + 보상형 광고");
    await save.click();
    const r3 = p3.getByRole("dialog", { name: "회의실" });
    await r3.locator("[data-testid=statements] article").first().waitFor({ timeout: 10000 });
    check("붙여넣은 답변 → 회의록 9개 부서 저장", (await r3.locator("[data-testid=statements] article").count()) === 9);
    check("결정 선택지 A·B·C 표시", (await r3.getByRole("radio").count()) === 3);
    await p3.screenshot({ path: OUT + "lite-paste-tab.png" });
    await p3.close();
  }

  // ── long Markdown agenda as the topic: short title, full agenda folded ──
  {
    const p4 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p4.goto("http://localhost:4457/");
    await p4.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
    await p4.getByRole("button", { name: "회의 소집" }).click();
    const d4 = p4.getByRole("dialog", { name: "회의 소집" });
    await d4.getByRole("radio").nth(0).check();
    await p4.fill("#meeting-topic", "# [회의 안건] 공모전 과제 확정\n## 0. 회의 목적\n- 7개 과제 중 하나를 고른다.\n## 1. 확인된 사실\n| 순위 | 과제 |\n|---|---|\n| 1 | A |");
    await d4.getByRole("button", { name: /회의 시작/ }).click();
    const r4 = p4.getByRole("dialog", { name: "회의실" });
    await r4.getByTestId("answer-box").waitFor();
    check("긴 안건: 제목은 첫 줄만", (await r4.locator("h2").first().innerText()).trim() === "공모전 과제 확정");
    await r4.getByText(/안건 전체 보기/).click();
    check("긴 안건: 전체 보기에 표로 표시", (await r4.getByTestId("topic-full").locator("table").count()) === 1);
    await p4.screenshot({ path: OUT + "lite-long-topic.png" });
    await p4.close();
  }

  // ── 12 employees, people leave a waiting meeting when its window closes, 회의록 panel ──
  {
    const p5 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await p5.goto("http://localhost:4457/?test=1");
    await p5.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
    await p5.waitForFunction(() => !!window.__officeTest);
    const actors = await p5.evaluate(() => window.__officeTest.actors());
    check("직원 12명", actors.length === 12, actors.map((a) => a.id).join(","));
    const room = (id) => p5.evaluate((i) => { const a = window.__officeTest.actors().find((x) => x.id === i); return { x: Math.floor(a.x / 16), y: Math.floor(a.y / 16), moving: a.moving }; }, id);
    const office = await p5.evaluate(() => fetch("/api/office").then((r) => r.json()));
    const byRoom = (r) => office.employees.filter((e) => e.room === r).map((e) => e.name);
    check("전략기획실 3명 · 개발실 3명", byRoom("strategy").length === 3 && byRoom("dev").length === 3, `전략 ${byRoom("strategy")} / 개발 ${byRoom("dev")}`);

    // a paste meeting: participants gather while the room window is open, leave when it closes unanswered
    await p5.getByRole("button", { name: "회의 소집" }).click();
    await p5.fill("#meeting-topic", "복귀 테스트");
    await p5.getByRole("dialog", { name: "회의 소집" }).getByRole("button", { name: /회의 시작/ }).click();
    const rm = p5.getByRole("dialog", { name: "회의실" });
    await rm.getByTestId("answer-box").waitFor();
    const inMeeting = async () => (await Promise.all(["validator", "cto"].map(room))).filter((p) => p.y >= 21 && p.x >= 17 && p.x <= 30).length;
    await p5.waitForFunction(() => window.__officeTest.actors().filter((a) => ["validator", "cto"].includes(a.id) && Math.floor(a.y / 16) >= 21 && Math.floor(a.x / 16) >= 17 && Math.floor(a.x / 16) <= 30 && !a.moving).length === 2, null, { timeout: 30000 }).catch(() => {});
    check("회의실 창이 열려 있으면 참석자가 회의실에 모임", (await inMeeting()) === 2);
    await rm.getByRole("button", { name: "닫기" }).click();
    await p5.waitForFunction(() => window.__officeTest.actors().filter((a) => ["validator", "cto"].includes(a.id) && Math.floor(a.y / 16) < 15 && !a.moving).length === 2, null, { timeout: 30000 }).catch(() => {});
    check("답 없이 창을 닫으면 각자 부서로 복귀", (await inMeeting()) === 0, JSON.stringify(await Promise.all(["validator", "cto"].map(room))));

    // finished meeting via the paste tab → shows up in 회의록
    await p5.getByRole("button", { name: "회의 소집" }).click();
    const d5 = p5.getByRole("dialog", { name: "회의 소집" });
    await d5.getByRole("tab", { name: /받은 답변 바로 붙여넣기/ }).click();
    await p5.fill("#meeting-paste", fs.readFileSync(path.join(ROOT, "e2e/fixtures-meeting-answer.txt"), "utf8"));
    await p5.fill("#meeting-topic", "# [회의 안건] MEMORY 모드 결정\n## 목적\n- 테스트");
    await d5.getByRole("button", { name: "회의록으로 저장" }).click();
    await p5.getByRole("dialog", { name: "회의실" }).locator("[data-testid=statements] article").first().waitFor({ timeout: 10000 });
    await p5.getByRole("dialog", { name: "회의실" }).getByRole("button", { name: "닫기" }).click();
    await p5.getByRole("button", { name: "📄 회의록" }).click();
    const mm = p5.getByRole("dialog", { name: "회의록" });
    await mm.getByTestId("minutes-list").waitFor({ timeout: 10000 });
    const det = await mm.getByTestId("minutes-detail").innerText();
    check("회의록 칸: 완료 회의 목록 + 요약·선택지", (await mm.getByTestId("minutes-list").locator("li").count()) === 1 && det.includes("MEMORY 모드 결정") && det.includes("회의 요약") && det.includes("결정 대기"));
    await p5.screenshot({ path: OUT + "lite-minutes.png" });
    await mm.getByRole("button", { name: /회의록 열기/ }).click();
    const rm2 = p5.getByRole("dialog", { name: "회의실" });
    await rm2.getByRole("radio").first().check();
    await rm2.getByRole("button", { name: "결정 기록" }).click();
    await rm2.getByText("결정을 기록했습니다").waitFor();
    await rm2.getByRole("button", { name: "닫기" }).click();
    await p5.getByRole("button", { name: "📄 회의록" }).click();
    await p5.getByRole("dialog", { name: "회의록" }).getByText("결정 완료", { exact: false }).first().waitFor({ timeout: 10000 });
    check("결정 후 회의록에 결정 표시", (await p5.getByRole("dialog", { name: "회의록" }).getByTestId("minutes-detail").innerText()).includes("[A]"));
    await p5.screenshot({ path: OUT + "lite-office-12.png" });
    await p5.close();
  }

  // ── call a whole department ──
  {
    const p6 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await p6.goto("http://localhost:4457/");
    await p6.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
    await p6.getByRole("button", { name: "회의 소집" }).click();
    const d6 = p6.getByRole("dialog", { name: "회의 소집" });
    await p6.screenshot({ path: OUT + "lite-dept-dialog.png" });
    await d6.getByRole("button", { name: "개발실만 회의" }).click();
    const sum = await d6.getByTestId("picked-summary").getAttribute("aria-label");
    check("개발실만 → 개발실 3명 + 한결", sum === "참석 4명");
    await d6.getByRole("button", { name: "마케팅·영업실 전체 부르기" }).click();
    check("부서 전체 추가 → 6명", (await d6.getByTestId("picked-summary").getAttribute("aria-label")) === "참석 6명");
    await d6.getByRole("button", { name: "마케팅·영업실 빼기" }).click();
    await p6.fill("#meeting-topic", "개발실 회의");
    await d6.getByRole("button", { name: /회의 시작/ }).click();
    const r6 = p6.getByRole("dialog", { name: "회의실" });
    await p6.waitForFunction(() => (document.querySelector("[role=dialog] textarea[readonly]")?.value ?? "").includes("PARTICIPANTS"), null, { timeout: 10000 });
    const pr = await r6.locator("textarea[readonly]").inputValue();
    check("부서 회의 지시문 참석자", /PARTICIPANTS: cto,ai-engineer,frontend,ceo-advisor/.test(pr), /PARTICIPANTS: .*/.exec(pr)?.[0]);
    await p6.close();
  }

  // ── denied consent ──
  const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p2.addInitScript(fake("deny"));
  await p2.goto("http://localhost:4457/");
  await p2.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
  await p2.getByRole("button", { name: "회의 소집" }).click();
  await p2.fill("#meeting-topic", "거절 테스트");
  await p2.getByRole("dialog", { name: "회의 소집" }).getByRole("button", { name: /회의 시작/ }).click();
  const room2 = p2.getByRole("dialog", { name: "회의실" });
  await room2.getByText("허용하지 않아").waitFor({ timeout: 10000 });
  check("허용 거절 → 안내 + 붙여넣기 칸 그대로", await room2.getByTestId("answer-box").isVisible());
  await p2.close();

  // ── top bar at narrow widths: nothing clipped vertically, header height sane ──
  for (const [w, hgt] of [[900, 600], [700, 600], [390, 760]]) {
    const p = await browser.newPage({ viewport: { width: w, height: hgt } });
    await p.goto("http://localhost:4457/");
    await p.getByText("사무실을 여는 중").waitFor({ state: "detached", timeout: 30000 });
    const r = await p.evaluate(() => {
      const hd = document.querySelector("header");
      const bad = [...hd.querySelectorAll("button,span")].filter((el) => {
        const b = el.getBoundingClientRect();
        return b.height > 0 && b.height < 12; // squashed
      }).length;
      const btn = [...hd.querySelectorAll("button")].find((b) => b.textContent.trim() === "회의 소집").getBoundingClientRect();
      const meetVisible = btn.left >= 0 && btn.right <= innerWidth && btn.top >= 0;
      return { h: hd.getBoundingClientRect().height, bad, docW: document.documentElement.scrollWidth, meetVisible };
    });
    check(`상단 바 ${w}px: 찌그러짐·가로 넘침 없음`, r.h < 130 && r.bad === 0 && r.docW <= w && r.meetVisible, `회의 소집 보임 ${r.meetVisible} · 높이 ${Math.round(r.h)} · 문서 폭 ${r.docW}`);
    await p.screenshot({ path: OUT + `lite-top-${w}.png` });
    await p.close();
  }
  check("페이지 오류 없음", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
  server.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
