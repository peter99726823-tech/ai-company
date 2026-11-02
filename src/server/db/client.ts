/**
 * One SQLite connection per process (the Next.js server and the worker each open their own).
 * Migrations are applied automatically on first use, then the seed runs if the DB is empty.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { seedIfEmpty, ensurePrompts } from "./seed-data";

export type DB = BetterSQLite3Database<typeof schema>;

const g = globalThis as unknown as { __companyDb?: DB };

export function getDb(): DB {
  if (g.__companyDb) return g.__companyDb;
  const file = process.env.DATABASE_PATH
    ? path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH)
    : path.join(process.cwd(), "data", "company.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL"); // lets the worker and the web server share the file
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  seedIfEmpty(db);
  ensurePrompts(db);
  g.__companyDb = db;
  return db;
}
