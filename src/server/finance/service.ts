/** Transactions the CEO enters. Real and simulated entries are always kept apart. */
import { randomUUID } from "node:crypto";
import { desc, eq, like } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { TaskInputError } from "../tasks/service";

export interface TxInput {
  date: string;
  description: string;
  amountKrw: number; // + income, - expense
  category?: string;
  projectId?: string | null;
  isSimulation?: boolean;
}

export function addTransaction(db: DB, t: TxInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date ?? "")) throw new TaskInputError("날짜를 YYYY-MM-DD 형식으로 입력하세요.");
  if (!t.description?.trim()) throw new TaskInputError("내용을 입력하세요.");
  const amount = Math.round(Number(t.amountKrw));
  if (!Number.isFinite(amount) || amount === 0) throw new TaskInputError("금액을 입력하세요.");
  const id = `tx_${randomUUID().slice(0, 8)}`;
  db.insert(s.financialTransactions)
    .values({ id, date: t.date, description: t.description.trim().slice(0, 200), amountKrw: amount, category: t.category?.trim() || null, projectId: t.projectId || null, isSimulation: !!t.isSimulation })
    .run();
  return db.select().from(s.financialTransactions).where(eq(s.financialTransactions.id, id)).get()!;
}

export function deleteTransaction(db: DB, id: string) {
  db.delete(s.financialTransactions).where(eq(s.financialTransactions.id, id)).run();
  return { ok: true };
}

export function listTransactions(db: DB, month?: string | null) {
  const q = db.select().from(s.financialTransactions);
  const rows = (month ? q.where(like(s.financialTransactions.date, `${month}%`)) : q).orderBy(desc(s.financialTransactions.date)).all();
  const sum = (sim: boolean) => {
    const r = rows.filter((x) => !!x.isSimulation === sim);
    const income = r.filter((x) => x.amountKrw > 0).reduce((a, x) => a + x.amountKrw, 0);
    const expense = r.filter((x) => x.amountKrw < 0).reduce((a, x) => a - x.amountKrw, 0);
    return { income, expense, net: income - expense, count: r.length };
  };
  return { rows, real: sum(false), simulation: sum(true) };
}

/** Markdown table for the bookkeeper's prompt. */
export function transactionsForPrompt(db: DB, projectId: string | null): string {
  const rows = db.select().from(s.financialTransactions).orderBy(desc(s.financialTransactions.date)).limit(300).all().filter((r) => !projectId || r.projectId === projectId || !r.projectId);
  if (!rows.length) return "(앱에 입력된 거래내역이 없습니다)";
  const line = (r: (typeof rows)[number]) => `| ${r.date} | ${r.description.replace(/\|/g, "/")} | ${r.amountKrw.toLocaleString("ko-KR")} | ${r.category ?? ""} | ${r.isSimulation ? "시뮬레이션" : "실제"} |`;
  return `| 날짜 | 내용 | 금액(원, +수입 -지출) | 분류 | 구분 |\n|---|---|---|---|---|\n${rows.map(line).join("\n")}`;
}
