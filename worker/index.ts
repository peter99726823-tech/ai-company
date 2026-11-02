/**
 * Worker process: the only place AI calls happen.
 * Runs separately from the web server so tasks keep going when the browser is closed.
 * If this process stops, tasks stop too — the top bar shows "실행기 꺼짐".
 *
 *   npm run worker      (npm run dev starts it together with the web server)
 */
import { randomUUID } from "node:crypto";
import { getDb } from "../src/server/db/client";
import { claimNext, failStaleTasks, runTask } from "../src/server/tasks/runner";
import { failOwnedTasks } from "../src/server/tasks/runner";
import { setSetting } from "../src/server/settings";
import { engineConfigFromEnv } from "../src/server/ai/engine";
import { runScheduler } from "../src/server/autonomy/service";

const owner = `worker_${process.pid}_${randomUUID().slice(0, 6)}`;
const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.WORKER_CONCURRENCY ?? 1)));
const db = getDb();
let running = 0;
let stopping = false;

function heartbeat() {
  const cfg = engineConfigFromEnv();
  setSetting(db, "worker", {
    owner,
    pid: process.pid,
    at: Date.now(),
    running,
    keyConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    model: cfg.model,
    webSearch: cfg.webSearch,
    fallbacks: cfg.fallbacks,
  });
}

async function tick() {
  if (stopping) return;
  while (running < CONCURRENCY) {
    const task = claimNext(db, owner);
    if (!task) break;
    running++;
    console.log(`[worker] ▶ ${task.id} (${task.employeeId}) ${task.title}`);
    runTask(db, owner, task)
      .catch((e) => console.error(`[worker] ${task.id} crashed`, e))
      .finally(() => {
        running--;
        console.log(`[worker] ■ ${task.id}`);
      });
  }
}

const failed = failStaleTasks(db);
if (failed) console.log(`[worker] 이전 실행기가 남긴 미완료 업무 ${failed}건을 실패 처리했습니다.`);
heartbeat();
const hb = setInterval(heartbeat, 5000);
const loop = setInterval(() => void tick(), 1000);
const staleLoop = setInterval(() => failStaleTasks(db), 30000);
// Recurring work (PHASE 4): runs here, server-side, so it keeps going with the browser closed.
const schedule = () => {
  try {
    const fired = runScheduler(db, Date.now(), Boolean(process.env.ANTHROPIC_API_KEY?.trim()));
    for (const f of fired) console.log(`[worker] 반복 업무 ${f.id}: ${f.result}`);
  } catch (e) {
    console.error("[worker] scheduler", e);
  }
};
schedule();
const scheduleLoop = setInterval(schedule, 30000);
console.log(
  `[worker] 시작 · ${owner} · 동시 실행 ${CONCURRENCY} · 모델 ${engineConfigFromEnv().model} · API 키 ${process.env.ANTHROPIC_API_KEY?.trim() ? "있음" : "없음"}`,
);

function shutdown() {
  stopping = true;
  clearInterval(loop);
  clearInterval(staleLoop);
  clearInterval(scheduleLoop);
  clearInterval(hb);
  const n = failOwnedTasks(db, owner);
  if (n) console.log(`[worker] 진행 중이던 업무 ${n}건을 실패 처리했습니다 (실행기 종료).`);
  setSetting(db, "worker", { owner, pid: process.pid, at: 0, running: 0, stopped: true });
  console.log("[worker] 종료");
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
