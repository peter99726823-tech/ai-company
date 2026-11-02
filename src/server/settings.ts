import { eq } from "drizzle-orm";
import type { DB } from "./db/client";
import * as s from "./db/schema";

export function setSetting(db: DB, key: string, value: unknown) {
  const v = JSON.stringify(value);
  db.insert(s.settings)
    .values({ key, value: v, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: v, updatedAt: Date.now() } })
    .run();
}

export function getSetting<T>(db: DB, key: string): T | null {
  const row = db.select().from(s.settings).where(eq(s.settings.key, key)).get();
  return row ? (JSON.parse(row.value) as T) : null;
}
