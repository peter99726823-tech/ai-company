import { count } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { EMPLOYEES, PROJECT_SEEDS } from "../../domain/employees";
import { systemPromptFor } from "../ai/prompts";

/** Inserts the company, the nine employees and the founder's projects — only when the DB is empty. */
export function seedIfEmpty(db: BetterSQLite3Database<typeof schema>): boolean {
  const [{ n }] = db.select({ n: count() }).from(schema.employees).all();
  if (n > 0) return false;
  db.transaction((tx) => {
    tx.insert(schema.company).values({ id: "main", name: "나의 AI 회사", mission: "AI로 실제 제품을 만들고 지속 가능한 수익을 낸다" }).run();
    for (const e of EMPLOYEES) {
      tx.insert(schema.employees)
        .values({
          id: e.id,
          name: e.name,
          title: e.title,
          titleKo: e.titleKo,
          room: e.room,
          deskId: e.deskId,
          command: e.command,
          expertise: JSON.stringify(e.expertise),
          look: JSON.stringify(e.look),
        })
        .run();
    }
    for (const p of PROJECT_SEEDS) tx.insert(schema.projects).values(p).run();
    tx.insert(schema.settings).values({ key: "autonomy_mode", value: JSON.stringify("manual") }).run();
  });
  return true;
}

/** Version 1 system prompt for any employee that has none yet. */
export function ensurePrompts(db: BetterSQLite3Database<typeof schema>) {
  const have = new Set(db.select({ id: schema.employeePrompts.employeeId }).from(schema.employeePrompts).all().map((r) => r.id));
  for (const e of EMPLOYEES) {
    if (have.has(e.id)) continue;
    db.insert(schema.employeePrompts).values({ id: `prompt_${e.id}_v1`, employeeId: e.id, version: 1, systemPrompt: systemPromptFor(e.id) }).run();
  }
}
