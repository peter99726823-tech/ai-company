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

  await rm.getByRole("button", { name: "닫기" }).click();

  // ── PHASE 4: settings, routines, proposals ──
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const st = page.getByRole("dialog", { name: "설정" });
  await st.getByRole("radio", { name: /반자동/ }).check();
  await page.waitForFunction(() => document.querySelector("header")?.textContent?.includes("반자동 모드"), null, { timeout: 5000 });
  check("운영 모드 → 반자동 (상단 바 표시)", true);
  await st.getByLabel("반복 이름").fill("주간 지출 점검");
  await st.getByLabel("반복 업무 내용").fill("이번 주 지출을 점검하고 줄일 항목을 제안해줘");
  await st.getByLabel("반복 담당").selectOption("bookkeeper");
  await st.getByRole("button", { name: "반복 업무 등록" }).click();
  await st.locator("[data-testid=routines] li", { hasText: "주간 지출 점검" }).waitFor();
  check("반복 업무 등록", true);
  await st.locator("[data-testid=routines] li", { hasText: "주간 지출 점검" }).getByRole("button", { name: "지금 실행" }).click();
  await st.getByText("업무를 만들었습니다").waitFor();
  check("반복 업무 '지금 실행' → 업무 생성", true);
  await st.getByRole("button", { name: "닫기" }).click();

  // a report in semi mode produces proposals
  await page.evaluate(async () => {
    const r = await fetch("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: "validator", instruction: "시장 검증" }) });
    const t = (await r.json()).task;
    await fetch(`/api/tasks/${t.id}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "## 요약\n[테스트 문구] 검증 요약입니다. 충분히 긴 본문입니다.\n## 다음 추천 업무\n- 경쟁사 가격 조사\n- 사용자 인터뷰 5명" }) });
  });
  await page.locator("[data-testid=proposal]").first().waitFor({ timeout: 10000 });
  check("반자동: 보고서의 다음 추천 업무 → 제안 2건", (await page.locator("[data-testid=proposal]").count()) === 2);
  await page.locator("[data-testid=proposal]").first().getByRole("button", { name: "승인", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll("[data-testid=proposal]").length === 1, null, { timeout: 10000 });
  check("제안 승인 → 업무로 전환", true);

  // ── finance ──
  await page.getByRole("button", { name: "재무", exact: true }).click();
  const fm = page.getByRole("dialog", { name: "재무 · 거래내역" });
  await fm.getByLabel("내용").fill("서버 비용");
  await fm.getByLabel("금액").fill("30,000");
  await fm.getByRole("button", { name: "거래 추가" }).click();
  await fm.getByLabel("내용").fill("가상 구독 매출");
  await fm.getByLabel("수입 지출").selectOption("income");
  await fm.getByLabel("금액").fill("100000");
  await fm.getByText("시뮬레이션 (실제 거래 아님)").click();
  await fm.getByRole("button", { name: "거래 추가" }).click();
  await fm.locator("tbody tr").nth(1).waitFor();
  const sum = await fm.locator("[data-testid=finance-summary]").innerText();
  check("거래 입력: 실제와 시뮬레이션 분리 합계", sum.includes("지출 30,000원") && sum.includes("시뮬레이션 (1건"));
  await fm.getByRole("button", { name: "지호에게 분석 요청" }).click();
  const mm = page.getByRole("dialog", { name: "붙여넣기로 업무 처리" });
  await page.waitForFunction(() => (document.querySelector("[aria-label='붙여넣기로 업무 처리'] textarea[readonly]")?.value ?? "").includes("서버 비용"), null, { timeout: 10000 });
  check("분석 요청 지시문에 거래내역 자동 첨부", true);
  await mm.getByRole("button", { name: "닫기" }).click();

  // ── projects ──
  await page.getByRole("button", { name: "프로젝트", exact: true }).click();
  const pm = page.getByRole("dialog", { name: "프로젝트 관리" });
  await pm.locator("[data-testid=project-detail]").waitFor();
  await pm.getByLabel("현재 단계").fill("개발 중");
  await pm.getByLabel("예산").fill("200000");
  await pm.getByRole("button", { name: "저장" }).click();
  await pm.getByText("저장했습니다").waitFor();
  const pj = await page.evaluate(() => fetch("/api/office").then((r) => r.json()).then((o) => o.projects[0]));
  check("프로젝트 편집 저장", pj.stage === "개발 중" && pj.budgetMicros === 200000);
  await pm.getByRole("button", { name: "닫기" }).click();

  // ── backup & restore ──
  await page.getByRole("button", { name: "설정", exact: true }).click();
  const st2 = page.getByRole("dialog", { name: "설정" });
  const [dl] = await Promise.all([page.waitForEvent("download"), st2.getByRole("button", { name: "백업 파일 저장" }).click()]);
  const backupPath = OUT + "lite-backup.json";
  await dl.saveAs(backupPath);
  const bj = JSON.parse(fs.readFileSync(backupPath, "utf8"));
  check("백업 파일 저장 (JSON, SQLite 포함)", bj.format === "ai-company-backup" && Buffer.from(bj.sqlite, "base64").subarray(0, 15).toString() === "SQLite format 3");
  // change something, then restore and check it is gone
  await page.evaluate(() => fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: "2026-11-02", description: "복원 후 사라질 거래", amountKrw: -1 }) }));
  await st2.getByLabel("백업 파일 선택").setInputFiles(backupPath);
  await st2.getByRole("button", { name: /복원 실행/ }).click();
  await st2.getByText("복원했습니다").waitFor();
  const after = await page.evaluate(() => fetch("/api/finance").then((r) => r.json()));
  check("백업에서 복원", !after.rows.some((r) => r.description === "복원 후 사라질 거래") && after.rows.some((r) => r.description === "서버 비용"));
  await st2.getByRole("button", { name: "닫기" }).click();
  await page.screenshot({ path: OUT + "lite-03-phase4.png" });

  // ── file attachments (txt + PDF made on the fly) ──
  const pdfPage = await browser.newPage();
  await pdfPage.setContent("<h1>Contract TEST-PDF-777</h1><p>제7조 위약금 조항 테스트</p>");
  const pdfPath = OUT + "lite-test.pdf";
  await pdfPage.pdf({ path: pdfPath });
  await pdfPage.close();
  const txtPath = OUT + "lite-test.txt";
  fs.writeFileSync(txtPath, "텍스트첨부 TXT-123 내용");
  await clickEmployee("contract");
  await page.locator("aside").getByRole("button", { name: "업무 지시", exact: true }).first().click();
  await page.locator("#order-type").selectOption("CONTRACT_FILE");
  await page.locator("aside").getByLabel("파일 첨부").setInputFiles([pdfPath, txtPath]);
  await page.locator("aside [data-testid=attachments]").getByText("lite-test.pdf").waitFor({ timeout: 20000 });
  await page.locator("aside [data-testid=attachments]").getByText("lite-test.txt").waitFor();
  check("PDF·텍스트 파일 첨부 → 글자 추출", true);
  await page.fill("#order-text", "첨부한 계약서 검토해줘");
  await page.locator("aside").getByRole("button", { name: "업무 지시하기" }).click();
  const ap = page.getByRole("dialog", { name: "붙여넣기로 업무 처리" });
  await page.waitForFunction(() => (document.querySelector("[aria-label='붙여넣기로 업무 처리'] textarea[readonly]")?.value ?? "").includes("TEST-PDF-777"), null, { timeout: 10000 });
  const ptxt = await ap.locator("textarea[readonly]").inputValue();
  check("첨부 내용이 지시문에 포함 (PDF 본문 + 텍스트)", ptxt.includes("TEST-PDF-777") && ptxt.includes("제7조") && ptxt.includes("TXT-123"));
  await ap.getByRole("button", { name: "닫기" }).click();
  await page.locator("aside").getByRole("button", { name: "닫기" }).click();

  const badPath = OUT + "lite-test.hwp";
  fs.writeFileSync(badPath, "x");
  await page.getByRole("button", { name: "회의 소집" }).click();
  const md = page.getByRole("dialog", { name: "회의 소집" });
  await md.getByLabel("파일 첨부").setInputFiles(badPath);
  await md.getByText("이 형식은 아직 읽지 못합니다").waitFor();
  check("지원하지 않는 형식은 안내 (지어내지 않음)", true);
  await md.getByRole("button", { name: "닫기" }).click();

  // ── idea inbox ──
  await page.getByRole("button", { name: /^아이디어/ }).click();
  const im = page.getByRole("dialog", { name: "아이디어 메모함" });
  await im.getByLabel("아이디어", { exact: true }).fill("카페 재고를 사진으로 세는 앱");
  await im.getByLabel("아이디어 메모").fill("사장님들이 매일 손으로 셈");
  await im.getByRole("button", { name: "적어 두기" }).click();
  await im.locator("[data-testid=ideas] li", { hasText: "카페 재고" }).waitFor();
  check("아이디어 적어 두기", (await page.locator("header").innerText()).includes("아이디어 1"));
  await im.locator("[data-testid=ideas] li", { hasText: "카페 재고" }).getByRole("button", { name: "서진에게 검증 맡기기" }).click();
  const vp = page.getByRole("dialog", { name: "붙여넣기로 업무 처리" });
  await page.waitForFunction(() => (document.querySelector("[aria-label='붙여넣기로 업무 처리'] textarea[readonly]")?.value ?? "").includes("카페 재고"), null, { timeout: 10000 });
  check("아이디어 → 서진 검증 업무 (지시문에 아이디어 포함)", true);
  await vp.getByRole("button", { name: "닫기" }).click();
  await page.getByRole("button", { name: /^아이디어/ }).click();
  await im.locator("[data-testid=ideas] li", { hasText: "카페 재고" }).getByRole("button", { name: "회의 열기" }).click();
  const room4 = page.getByRole("dialog", { name: "회의실" });
  await room4.locator("[data-testid=manual-run]").waitFor({ timeout: 10000 });
  check("아이디어 → 회의 열기", (await room4.innerText()).includes("카페 재고"));
  await room4.getByRole("button", { name: "닫기" }).click();

  // ── drag & drop ──
  // Simulates a real OS file drag: dragenter → dragover → drop with a DataTransfer holding Files.
  const dropFiles = (selector, files, { dropIt = true } = {}) =>
    page.evaluate(
      async ({ selector, files, dropIt }) => {
        const el = document.querySelector(selector);
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(new File([f.text], f.name, { type: f.type }));
        const fire = (type, target = el) => target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
        fire("dragenter");
        fire("dragover");
        await new Promise((r) => setTimeout(r, 80)); // let React draw the hint
        const overlay = !!document.querySelector("[data-testid=drop-overlay]");
        if (dropIt) fire("drop");
        else fire("dragleave");
        return overlay;
      },
      { selector, files, dropIt },
    );
  await page.getByRole("button", { name: "회의 소집" }).click();
  const shownOverlay = await dropFiles("[aria-label='회의 소집'] form", [{ name: "끌어놓기.txt", text: "DRAG-DROP-901 회의자료", type: "text/plain" }], { dropIt: false });
  await page.waitForTimeout(100);
  check("끌고 오면 '여기에 놓으면 첨부' 안내 표시, 벗어나면 사라짐", shownOverlay && (await page.locator("[data-testid=drop-overlay]").count()) === 0);
  await dropFiles("[aria-label='회의 소집'] form", [
    { name: "끌어놓기.txt", text: "DRAG-DROP-901 회의자료", type: "text/plain" },
    { name: "표.csv", text: "항목,값\nA,1", type: "text/csv" },
  ]);
  const md2 = page.getByRole("dialog", { name: "회의 소집" });
  await md2.locator("[data-testid=attachments]").getByText("끌어놓기.txt").waitFor({ timeout: 10000 });
  await md2.locator("[data-testid=attachments]").getByText("표.csv").waitFor();
  check("회의 소집 창에 파일 2개 끌어놓기 → 첨부", true);
  await page.fill("#meeting-topic", "끌어놓기 회의");
  await md2.getByRole("button", { name: "회의 시작" }).click();
  const room5 = page.getByRole("dialog", { name: "회의실" });
  await page.waitForFunction(() => (document.querySelector("[aria-label='회의실'] textarea[readonly]")?.value ?? "").includes("DRAG-DROP-901"), null, { timeout: 10000 });
  check("끌어놓은 파일 내용이 회의 지시문에 포함", true);
  await room5.getByRole("button", { name: "닫기" }).click();

  await clickEmployee("ops");
  await page.locator("aside").getByRole("button", { name: "대화하기" }).click();
  await dropFiles("[aria-label='태오와 대화'] > div", [{ name: "스펙.md", text: "# 스펙 DROP-CHAT-33", type: "text/markdown" }]);
  await page.getByRole("dialog", { name: /태오와 대화/ }).locator("[data-testid=attachments]").getByText("스펙.md").waitFor({ timeout: 10000 });
  check("대화창에 끌어놓기 → 첨부", true);
  await page.getByRole("dialog", { name: /태오와 대화/ }).getByRole("button", { name: "닫기" }).click();

  await page.locator("aside").getByRole("button", { name: "업무 지시", exact: true }).first().click();
  await dropFiles("[data-testid=order-form]", [{ name: "자료.txt", text: "ORDER-DROP-7", type: "text/plain" }]);
  await page.locator("[data-testid=order-form] [data-testid=attachments]").getByText("자료.txt").waitFor({ timeout: 10000 });
  check("업무 지시 양식에 끌어놓기 → 첨부", true);
  const before = page.url();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "밖.txt", { type: "text/plain" }));
    const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
    document.querySelector("canvas").dispatchEvent(ev);
    window.__dropPrevented = ev.defaultPrevented;
  });
  check("창 밖(사무실 화면)에 떨어뜨려도 브라우저가 파일을 열지 않음", (await page.evaluate(() => window.__dropPrevented)) && page.url() === before);
  await page.locator("aside").getByRole("button", { name: "닫기" }).click();

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
