"use client";

import { useCallback, useEffect, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEES, EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import type { OfficeSnapshot } from "@/server/services/office";
import { Modal, api, inputCls, btnCls, primaryCls } from "./Modal";

interface Detail {
  project: { id: string; name: string; description: string; goal: string; stage: string; nextPlan: string; ownerId: string | null; budgetKrw: number | null; revenueKrw: number | null };
  tasks: { id: string; title: string; employeeId: string; status: string; meetingId: string | null }[];
  reports: { id: string; title: string; employeeId: string; createdAt: number; meetingId: string | null }[];
  meetings: { id: string; topic: string; status: string }[];
  money: { income: number; expense: number };
}

export function ProjectsModal({ data, reload }: { data: OfficeSnapshot | null; reload: () => void }) {
  const open = useOffice((s) => s.panel === "projects");
  const close = () => useOffice.getState().setPanel(null);
  const [sel, setSel] = useState<string | null>(null);
  const [d, setD] = useState<Detail | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [newName, setNewName] = useState("");

  const load = useCallback(async (id: string) => {
    const r = await fetch(`/api/projects/${id}`);
    const j = (await r.json()) as Detail;
    setD(j);
    const p = j.project;
    setForm({ name: p.name, description: p.description, goal: p.goal, stage: p.stage, nextPlan: p.nextPlan, ownerId: p.ownerId ?? "", budgetKrw: p.budgetKrw?.toString() ?? "", revenueKrw: p.revenueKrw?.toString() ?? "" });
  }, []);
  useEffect(() => {
    if (open && !sel && data?.projects[0]) setSel(data.projects[0].id);
  }, [open, sel, data]);
  useEffect(() => {
    if (open && sel) {
      setMsg(null);
      void load(sel);
    }
  }, [open, sel, load]);
  if (!open) return null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  async function save() {
    const { ok, j } = await api(`/api/projects/${sel}`, {
      ...form,
      budgetKrw: form.budgetKrw === "" ? null : Number(form.budgetKrw),
      revenueKrw: form.revenueKrw === "" ? null : Number(form.revenueKrw),
    });
    setMsg(ok ? "저장했습니다." : j.error ?? "저장하지 못했습니다.");
    reload();
    if (ok) void load(sel!);
  }
  async function create() {
    const { ok, j } = await api<{ id: string }>("/api/projects", { name: newName });
    if (!ok) return setMsg(j.error ?? "만들지 못했습니다.");
    setNewName("");
    reload();
    setSel(j.id);
  }

  return (
    <Modal label="프로젝트 관리" onClose={close} wide>
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          {data?.projects.map((p) => (
            <button key={p.id} type="button" onClick={() => setSel(p.id)} className={`block w-full truncate rounded-sm px-2 py-1 text-left ${sel === p.id ? "bg-hi/20 text-hi" : "hover:bg-panel-2"}`}>
              {p.name}
              <span className="block text-[11px] text-muted">{p.stage}</span>
            </button>
          ))}
          <div className="flex gap-1 pt-2">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="새 프로젝트" className={inputCls} />
            <button type="button" onClick={create} disabled={!newName.trim()} className={btnCls}>
              추가
            </button>
          </div>
        </div>
        {d && (
          <div className="space-y-3" data-testid="project-detail">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="text-[11px] text-muted">이름</span>
                <input aria-label="프로젝트 이름" value={form.name} onChange={set("name")} className={inputCls} />
              </label>
              <label className="sm:col-span-2">
                <span className="text-[11px] text-muted">설명</span>
                <textarea aria-label="설명" value={form.description} onChange={set("description")} rows={2} className={inputCls} />
              </label>
              <label>
                <span className="text-[11px] text-muted">목표</span>
                <input aria-label="목표" value={form.goal} onChange={set("goal")} className={inputCls} />
              </label>
              <label>
                <span className="text-[11px] text-muted">현재 단계</span>
                <input aria-label="현재 단계" value={form.stage} onChange={set("stage")} className={inputCls} />
              </label>
              <label className="sm:col-span-2">
                <span className="text-[11px] text-muted">다음 실행 계획</span>
                <input aria-label="다음 실행 계획" value={form.nextPlan} onChange={set("nextPlan")} className={inputCls} />
              </label>
              <label>
                <span className="text-[11px] text-muted">담당 AI 직원</span>
                <select aria-label="담당 직원" value={form.ownerId} onChange={set("ownerId")} className={inputCls}>
                  <option value="">없음</option>
                  {EMPLOYEES.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {e.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label>
                  <span className="text-[11px] text-muted">예산 (원)</span>
                  <input aria-label="예산" inputMode="numeric" value={form.budgetKrw} onChange={set("budgetKrw")} placeholder="미확인" className={inputCls} />
                </label>
                <label>
                  <span className="text-[11px] text-muted">매출 (원)</span>
                  <input aria-label="매출" inputMode="numeric" value={form.revenueKrw} onChange={set("revenueKrw")} placeholder="미확인" className={inputCls} />
                </label>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={save} className={primaryCls}>
                저장
              </button>
              {msg && <span className="text-[12px] text-ok">{msg}</span>}
            </div>
            <p className="text-[12px] text-muted">
              입력된 실제 거래: 수입 {d.money.income.toLocaleString()}원 · 지출 {d.money.expense.toLocaleString()}원 (재무 창에서 프로젝트를 지정한 거래만)
            </p>
            <section>
              <h3 className="pixel mb-1 text-[12px] text-muted">업무 {d.tasks.length}건</h3>
              <ul className="space-y-0.5 text-[12px]">
                {d.tasks.slice(0, 15).map((t) => (
                  <li key={t.id} className="truncate">
                    <span className="pixel text-info">{TASK_STATUS_LABEL[t.status as TaskStatus]}</span> <span className="text-muted">{EMPLOYEE_BY_ID[t.employeeId]?.name}</span> {t.title}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h3 className="pixel mb-1 text-[12px] text-muted">보고서·회의록 {d.reports.length}건</h3>
              <ul className="space-y-0.5 text-[12px]">
                {d.reports.slice(0, 15).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="truncate text-left hover:text-hi" onClick={() => (r.meetingId ? useOffice.getState().openMeeting(r.meetingId) : useOffice.getState().openReport(r.id))}>
                      <span className="text-muted">{EMPLOYEE_BY_ID[r.employeeId]?.name}</span> {r.title}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}
      </div>
    </Modal>
  );
}
