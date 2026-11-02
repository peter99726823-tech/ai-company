// Starts the web server and the task worker together.  node scripts/run.mjs dev|start
// Stopping this process (Ctrl+C) stops both; tasks in progress are marked failed by the worker.
import { spawn } from "node:child_process";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = process.env.PORT ?? "3000";
const nextBin = new URL("../node_modules/next/dist/bin/next", import.meta.url).pathname;

const procs = [
  spawn(process.execPath, [nextBin, mode, "-p", port], { stdio: "inherit" }),
  spawn(
    process.execPath,
    ["--env-file-if-exists=.env.local", "--env-file-if-exists=.env", "--import", "tsx", ...(mode === "dev" ? ["--watch"] : []), "worker/index.ts"],
    { stdio: "inherit" },
  ),
];
console.log(`\n▶ 웹 http://localhost:${port}  +  업무 실행기 (${mode})\n`);

let exiting = false;
const stop = (code = 0) => {
  if (exiting) return;
  exiting = true;
  for (const p of procs) if (p.exitCode === null) p.kill("SIGTERM");
  setTimeout(() => process.exit(code), 1500);
};
for (const p of procs) p.on("exit", (c) => stop(c ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
