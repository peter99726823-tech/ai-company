// PHASE 1 end-to-end check. Run with the app on :3000 →  node e2e/phase1.mjs
// Uses the preinstalled Playwright + Chromium. Screenshots go to e2e/out/.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = new URL("./out/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const T = (fn, ...a) => page.evaluate(([f, args]) => window.__officeTest[f](...args), [fn, a]);
const canvasBox = async () => (await page.locator("[data-testid=office-canvas] canvas").boundingBox());

// STEP 1 — open the site
await page.goto(`${BASE}/?test=1`);
await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 20000 });
await sleep(800);
check("STEP 1 사이트 접속 · 게임 캔버스 생성", !!(await canvasBox()));

// STEP 2 — office + twelve employees
const actors = await T("actors");
check("STEP 2 직원 캐릭터 12명 표시", actors.length === 12, actors.map((a) => a.id).join(","));
const rooms = await page.evaluate(() => fetch("/api/office").then((r) => r.json()));
check("서버 DB에서 회사·직원·프로젝트 로드", rooms.employees.length === 12 && rooms.projects.length === 5, `${rooms.company.name} / 프로젝트 ${rooms.projects.length}개`);
await page.screenshot({ path: OUT + "01-office.png" });

// STEP 3 — idle animations only (no fake work)
const acts = new Set(actors.map((a) => a.activity));
check("STEP 3 대기 상태 애니메이션 (작업 연출 없음)", [...acts].every((a) => ["idle", "resting", "walk"].includes(a)), [...acts].join(","));
const animated = actors.every((a) => !!a.anim);
check("모든 캐릭터가 애니메이션 재생 중", animated);

// STEP 4 — click Business Validator
const box = await canvasBox();
let p = await T("screenPos", "validator");
await page.mouse.click(box.x + p.x, box.y + p.y);
await sleep(300);
const panel = page.getByRole("complementary", { name: /서진 상세/ });
check("STEP 4 Business Validator 클릭 → 상세 창", await panel.isVisible());
check("상세 창: 이름·직책·전문 분야·상태 표시", (await panel.innerText()).includes("Business Validator") && (await panel.innerText()).includes("경쟁사 분석"));
await page.screenshot({ path: OUT + "02-selected.png" });

// Order form: submit stays disabled until there is an instruction
await panel.getByRole("button", { name: "업무 지시", exact: true }).first().click();
const submit = panel.getByRole("button", { name: "업무 지시하기" });
check("업무 지시: 내용이 비어 있으면 제출 불가", await submit.isDisabled());
await page.screenshot({ path: OUT + "03-order-form.png" });
await panel.getByRole("button", { name: "정보" }).click();

// Animation preview: working → walks to desk, screen lights up
await panel.locator("summary").click();
await panel.getByRole("button", { name: "작업 중" }).click();
await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "working", null, { timeout: 30000 });
check("미리보기: 작업 중 → 책상으로 이동 후 working 애니메이션", true);
check("작업 중일 때 책상 모니터 점등", await T("screenLit", "desk-research-1"));
// meeting → walks to meeting room
await panel.getByRole("button", { name: "회의 중" }).click();
await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "meeting", null, { timeout: 40000 });
const v = (await T("actors")).find((a) => a.id === "validator");
const tx = Math.floor(v.x / 16), ty = Math.floor(v.y / 16);
check("미리보기: 회의 → 회의실 좌석 도착", tx >= 17 && tx <= 30 && ty >= 21 && ty <= 38, `tile ${tx},${ty}`);
await page.screenshot({ path: OUT + "04-meeting-preview.png" });
for (const a of ["생각 중", "보고 중", "휴식 중", "오류", "승인 대기"]) {
  await panel.getByRole("button", { name: a, exact: true }).click();
  await sleep(150);
}
await page.waitForFunction(() => window.__officeTest.actors().find((a) => a.id === "validator").activity === "waiting", null, { timeout: 40000 });
check("미리보기: 9가지 상태 전환 (마지막: 승인 대기)", true);
await panel.getByRole("button", { name: "미리보기 끝내기" }).click();

// Camera: wheel zoom, drag, fit, follow
const c0 = await T("camera");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -400);
await sleep(200);
const c1 = await T("camera");
check("마우스 휠 확대", c1.zoom > c0.zoom, `${c0.zoom.toFixed(2)} → ${c1.zoom.toFixed(2)}`);
await page.mouse.move(box.x + 300, box.y + 300);
await page.mouse.down();
await page.mouse.move(box.x + 450, box.y + 380, { steps: 8 });
await page.mouse.up();
const c2 = await T("camera");
check("드래그로 사무실 이동", Math.abs(c2.scrollX - c1.scrollX) > 10, `scrollX ${c1.scrollX.toFixed(0)} → ${c2.scrollX.toFixed(0)}`);
await page.getByRole("button", { name: "전체 보기" }).click();
await sleep(200);
const c3 = await T("camera");
check("전체 보기", Math.abs(c3.zoom - c0.zoom) < 0.01);
await page.getByRole("button", { name: /서진 따라가기/ }).click();
await sleep(1500);
const c4 = await T("camera");
check("특정 직원에게 카메라 이동", c4.zoom >= 2);
await page.screenshot({ path: OUT + "05-follow.png" });
await page.getByRole("button", { name: "전체 보기" }).click();

// Speed affects visuals only
await page.getByRole("button", { name: "4x" }).click();
check("배속 4x 선택", (await page.getByRole("button", { name: "4x" }).getAttribute("aria-pressed")) === "true");
await sleep(6000);
check("이동 중 벽·가구 통과 0회 (매 프레임 검사)", (await T("violations")).length === 0, (await T("violations")).join(" "));
await page.getByRole("button", { name: "1x" }).click();

// STEP 14-style persistence: reload keeps server data
await page.reload();
await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 20000 });
await sleep(1500);
check("새로고침 후 서버 데이터 유지", (await page.locator("header").innerText()).includes("나의 AI 회사"));

// Mobile layout
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await m.goto(`${BASE}/?test=1`);
await m.waitForFunction(() => !!window.__officeTest, null, { timeout: 20000 });
await sleep(800);
const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check("모바일 폭 가로 스크롤 없음", !overflow);
await m.screenshot({ path: OUT + "06-mobile.png" });

check("콘솔·페이지 오류 없음", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
