// PC version: PDF/text attachment in the browser (pdf.js worker served by Next) + idea inbox API.
//   npm run build && node e2e/pc-attach.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = path.join(ROOT, "e2e/out/");
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aico-pa-")), "pa.db");
const PORT = 3126;
const BASE = `http://localhost:${PORT}`;
const results = [];
const check = (n, ok, d = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`));
const srv = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: ROOT, env: { ...process.env, DATABASE_PATH: DB, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
const browser = await chromium.launch();
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const pdf = await browser.newPage();
  await pdf.setContent("<h1>PC-PDF-555</h1><p>한글 본문 확인</p>");
  await pdf.pdf({ path: OUT + "pc-test.pdf" });
  await pdf.close();
  await page.goto(`${BASE}/?test=1`);
  await page.waitForFunction(() => !!window.__officeTest, null, { timeout: 30000 });
  const box = await page.locator("[data-testid=office-canvas] canvas").boundingBox();
  const p = await page.evaluate(() => window.__officeTest.screenPos("contract"));
  await page.mouse.click(box.x + p.x, box.y + p.y);
  await page.locator("aside").getByRole("button", { name: "업무 지시", exact: true }).first().click();
  await page.locator("aside").getByLabel("파일 첨부").setInputFiles(OUT + "pc-test.pdf");
  await page.locator("aside [data-testid=attachments]").getByText("pc-test.pdf").waitFor({ timeout: 20000 });
  await page.fill("#order-text", "검토해줘");
  await page.locator("aside").getByRole("button", { name: "업무 지시하기" }).click();
  await page.waitForFunction(() => (document.querySelector("[aria-label='업무 처리'] textarea[readonly]")?.value ?? "").includes("PC-PDF-555"), null, { timeout: 15000 });
  const v = await page.locator("[aria-label='업무 처리'] textarea[readonly]").inputValue();
  check("PC: PDF 첨부 → 글자 추출 → 지시문 포함", v.includes("PC-PDF-555") && v.includes("한글 본문"));
  const idea = await fetch(`${BASE}/api/ideas`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "PC 아이디어" }) }).then((r) => r.json());
  const v2 = await fetch(`${BASE}/api/ideas/${idea.id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then((r) => r.json());
  check("PC: 아이디어 → 검증 업무 (API 경로)", !!v2.taskId);
  check("콘솔 오류 없음", errors.length === 0, errors.slice(0, 2).join(" | "));
} catch (e) {
  check("실행", false, e.message.split("\n")[0]);
} finally {
  await browser.close();
  srv.kill("SIGTERM");
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
