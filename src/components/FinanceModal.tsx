"use client";

import { useCallback, useEffect, useState } from "react";
import { useOffice } from "@/store/officeStore";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";
import { Modal, api, inputCls, btnCls, primaryCls } from "./Modal";

interface Fin {
  rows: { id: string; date: string; description: string; amountKrw: number; category: string | null; isSimulation: boolean; projectId: string | null }[];
  real: { income: number; expense: number; net: number; count: number };
  simulation: { income: number; expense: number; net: number; count: number };
}
const today = () => new Date().toISOString().slice(0, 10);
const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function FinanceModal({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const open = useOffice((s) => s.panel === "finance");
  const close = () => useOffice.getState().setPanel(null);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [f, setF] = useState<Fin | null>(null);
  const [form, setForm] = useState({ date: today(), description: "", amount: "", kind: "expense", category: "", projectId: "", sim: false });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;

  const load = useCallback(async () => {
    const r = await fetch(`/api/finance${month ? `?month=${month}` : ""}`);
    setF(await r.json());
  }, [month]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);
  if (!open) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const amt = Math.abs(Number(form.amount.replace(/[,\s원]/g, "")));
    const { ok, j } = await api("/api/finance", {
      date: form.date,
      description: form.description,
      amountKrw: form.kind === "income" ? amt : -amt,
      category: form.category,
      projectId: form.projectId || null,
      isSimulation: form.sim,
    });
    setMsg({ ok, t: ok ? "추가했습니다." : (j.error ?? "추가하지 못했습니다.") });
    if (ok) {
      setForm({ ...form, description: "", amount: "" });
      void load();
    }
  }
  async function del(id: string) {
    await api(`/api/finance/${id}/delete`, {});
    void load();
  }
  async function analyze() {
    const mode = apiReady ? "api" : "manual";
    const { ok, j } = await api<{ task: { id: string } }>("/api/tasks", {
      employeeId: "bookkeeper",
      type: "TRANSACTIONS",
      instruction: `${month || "전체 기간"} 거래내역을 분석해 월간 손익, 고정비·변동비, 이상 지출, 비용 절감 제안을 보고서로 작성해줘. 시뮬레이션 데이터는 실제와 분리해서 다뤄줘.`,
      executionMode: mode,
    });
    if (!ok) return setMsg({ ok: false, t: j.error ?? "요청하지 못했습니다." });
    reload();
    close();
    if (mode === "manual") useOffice.getState().openManual(j.task.id);
  }

  return (
    <Modal label="재무 · 거래내역" onClose={close} wide>
      <form onSubmit={add} className="grid gap-2 rounded-sm border-2 border-line p-3 sm:grid-cols-6">
        <input aria-label="날짜" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={`${inputCls} sm:col-span-2`} />
        <input aria-label="내용" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="내용 (예: 서버 비용)" className={`${inputCls} sm:col-span-4`} />
        <select aria-label="수입 지출" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} className={inputCls}>
          <option value="expense">지출</option>
          <option value="income">수입</option>
        </select>
        <input aria-label="금액" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="금액 (원)" className={`${inputCls} sm:col-span-2`} />
        <input aria-label="분류" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="분류 (선택)" className={inputCls} />
        <select aria-label="거래 프로젝트" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })} className={`${inputCls} sm:col-span-2`}>
          <option value="">프로젝트 없음</option>
          {data?.projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[12px] sm:col-span-3">
          <input type="checkbox" checked={form.sim} onChange={(e) => setForm({ ...form, sim: e.target.checked })} /> 시뮬레이션 (실제 거래 아님)
        </label>
        <button type="submit" disabled={!form.description.trim() || !form.amount.trim()} className={`${primaryCls} sm:col-span-3`}>
          거래 추가
        </button>
        {msg && <p className={`text-[12px] sm:col-span-6 ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input aria-label="월" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded-sm border-2 border-line bg-panel-2 px-2 py-1" />
        <button type="button" className={btnCls} onClick={() => setMonth("")}>
          전체 기간
        </button>
        <button type="button" onClick={analyze} className={`${primaryCls} ml-auto`}>
          지호에게 분석 요청
        </button>
      </div>
      {f && (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-2" data-testid="finance-summary">
            <div className="rounded-sm border border-line p-2">
              <div className="pixel text-[12px] text-ok">실제 거래 ({f.real.count}건)</div>
              수입 {won(f.real.income)} · 지출 {won(f.real.expense)} · <b>순이익 {won(f.real.net)}</b>
            </div>
            <div className="rounded-sm border border-dashed border-line p-2 text-muted">
              <div className="pixel text-[12px]">시뮬레이션 ({f.simulation.count}건, 합계에서 분리)</div>
              수입 {won(f.simulation.income)} · 지출 {won(f.simulation.expense)}
            </div>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1">날짜</th>
                  <th>내용</th>
                  <th className="text-right">금액</th>
                  <th>분류</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {f.rows.map((r) => (
                  <tr key={r.id} className={`border-t border-line/60 ${r.isSimulation ? "text-muted italic" : ""}`}>
                    <td className="py-1 font-mono">{r.date}</td>
                    <td>
                      {r.description}
                      {r.isSimulation && " (시뮬레이션)"}
                    </td>
                    <td className={`text-right font-mono ${r.amountKrw > 0 ? "text-ok" : ""}`}>{r.amountKrw.toLocaleString("ko-KR")}</td>
                    <td>{r.category}</td>
                    <td className="text-right">
                      <button type="button" onClick={() => del(r.id)} className="text-muted hover:text-bad" aria-label="거래 삭제">
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!f.rows.length && <p className="py-2 text-muted">이 기간에 입력된 거래가 없습니다.</p>}
          </div>
        </>
      )}
    </Modal>
  );
}
