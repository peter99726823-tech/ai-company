// PC version PHASE 4: the worker (not the browser) runs due routines; backup endpoint.
//   npm run build && node e2e/pc-phase4.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const ROOT = new URL("..", import.meta.url).pathname;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "aico-p4-")), "p4.db");
const PORT = 3125;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (n, ok, d = "") => (results.push(ok), console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? `  — ${d}` : ""}`));
const procs = [];
const start = (args) => {
  const p = spawn(process.execPath, args, { cwd: ROOT, env: { ...process.env, DATABASE_PATH: DB, ANTHROPIC_API_KEY: "" }, stdio: "ignore" });
  procs.push(p);
  return p;
};
const post = (url, body) => fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
try {
  start([path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)]);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await sleep(200);
  }
  await post("/api/settings/autonomy", { mode: "auto", dailyAutoLimit: 3 });
  const r = await post("/api/routines", { employeeId: "bookkeeper", title: "주간 지출 점검", instruction: "지출 점검", frequency: "daily", hour: 9 });
  check("반복 업무 등록 (API)", !!r.id);
  // test-only: make it due now, then start the worker with no browser open
  const raw = new Database(DB);
  raw.prepare("update routines set next_run_at = ? where id = ?").run(Date.now() - 1000, r.id);
  raw.close();
  start(["--import", "tsx", "worker/index.ts"]);
  let task = null;
  for (let i = 0; i < 40 && !task; i++) {
    await sleep(500);
    const o = await fetch(`${BASE}/api/office`).then((x) => x.json());
    task = o.byEmployee.bookkeeper.activeTask;
  }
  check("자동 모드: 브라우저 없이 실행기가 반복 업무 생성", task?.source === "routine" && task.status === "QUEUED", task ? `${task.title} · ${task.executionMode}` : "없음");
  check("API 키가 없으면 붙여넣기 방식으로 생성", task?.executionMode === "manual");
  const o2 = await fetch(`${BASE}/api/office`).then((x) => x.json());
  check("다음 실행 시각이 미래로 이동", o2.routines[0].nextRunAt > Date.now());
  const b = await fetch(`${BASE}/api/backup`).then((x) => x.json());
  check("백업 API: JSON 안에 SQLite", b.format === "ai-company-backup" && Buffer.from(b.sqlite, "base64").subarray(0, 15).toString() === "SQLite format 3");
  const rs = await fetch(`${BASE}/api/backup/restore`, { method: "POST" });
  check("PC 복원은 앱 실행 중 거부 (안내 문구)", rs.status === 409);
} catch (e) {
  check("실행", false, e.message);
} finally {
  for (const p of procs) p.kill("SIGTERM");
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
