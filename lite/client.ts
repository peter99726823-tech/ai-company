/**
 * Browser replacement for src/server/db/client.ts: the same Drizzle schema on sql.js (SQLite in WebAssembly).
 * The shared server code (tasks, meetings, reports) runs unchanged on top of it.
 */
import initSqlJs, { type Database } from "sql.js";
import { drizzle, type SQLJsDatabase } from "drizzle-orm/sql-js";
import * as schema from "../src/server/db/schema";
import { seedIfEmpty, ensurePrompts } from "../src/server/db/seed-data";
import wasm from "../node_modules/sql.js/dist/sql-wasm.wasm";
import m0 from "../drizzle/0000_init.sql";
import m1 from "../drizzle/0001_task_cancel.sql";
import m2 from "../drizzle/0002_meetings_manual.sql";
import m3 from "../drizzle/0003_chat.sql";

const MIGRATIONS = [m0, m1, m2, m3];

export type DB = SQLJsDatabase<typeof schema>;
let raw: Database | null = null;
let db: DB | null = null;

export async function initDb(saved: Uint8Array | null): Promise<DB> {
  const SQL = await initSqlJs({ wasmBinary: wasm as unknown as ArrayBuffer });
  raw = saved ? new SQL.Database(saved) : new SQL.Database();
  raw.run("PRAGMA foreign_keys = ON");
  const v = (raw.exec("PRAGMA user_version")[0]?.values[0][0] as number) ?? 0;
  MIGRATIONS.slice(v).forEach((sql, i) => {
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) raw!.run(stmt);
    raw!.run(`PRAGMA user_version = ${v + i + 1}`);
  });
  db = drizzle(raw, { schema });
  seedIfEmpty(db as never);
  ensurePrompts(db as never);
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error("데이터베이스가 아직 준비되지 않았습니다.");
  return db;
}

export function exportDb(): Uint8Array {
  return raw!.export();
}
