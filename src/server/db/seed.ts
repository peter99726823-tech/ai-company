// CLI: `npm run db:seed` — creates the DB (migrations) and seeds it if empty.
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { seedIfEmpty, ensurePrompts } from "./seed-data";

const file = path.resolve(process.env.DATABASE_PATH ?? "./data/company.db");
fs.mkdirSync(path.dirname(file), { recursive: true });
const db = drizzle(new Database(file), { schema });
migrate(db, { migrationsFolder: path.resolve("drizzle") });
const seeded = seedIfEmpty(db);
ensurePrompts(db);
console.log(seeded ? `Seeded ${file}` : `${file} already has data — seed skipped`);
