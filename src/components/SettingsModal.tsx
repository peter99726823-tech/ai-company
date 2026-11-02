"use client";

import { useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEES, EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_TYPES } from "@/domain/taskTypes";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";
import { Modal, api, inputCls, btnCls, primaryCls } from "./Modal";

const MODES = [
  { id: "manual", label: "수동", desc: "대표가 지시한 업무만 진행합니다. 반복 업무는 건너뜁니다." },
  { id: "semi", label: "반자동", desc: "반복 업무와 보고서의 '다음 추천 업무'가 제안으로 올라오고, 대표가 승인하면 진행합니다." },
  { id: "auto", label: "자동", desc: "미리 등록한 반복 업무만 스스로 시작합니다 (하루 한도까지). 한도를 넘거나 보고서에서 나온 제안은 승인을 받습니다." },
] as const;
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

async function saveFile(filename: string, text: string) {
  // Inside claude.ai the page must ask the viewer through the downloads capability.
  const c = (window as unknown as { claude?: { use(n: string): Promise<{ save(r: { filename: string; data: string }): Promise<unknown> } | null> } }).claude;
  const dl = c ? await c.use("downloads").catch(() => null) : null;
  if (dl) return dl.save({ filename, data: text });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export function SettingsModal({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const open = useOffice((s) => s.panel === "settings");
  const close = () => useOffice.getState().setPanel(null);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;
  const [r, setR] = useState({ employeeId: "bookkeeper", title: "", instruction: "", type: "GENERAL", projectId: "", frequency: "weekly", dayOfWeek: "1", dayOfMonth: "1", hour: "9", executionMode: "manual" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [restoreArmed, setRestoreArmed] = useState<unknown>(null);
  if (!open) return null;
  const a = data?.autonomy;
  const say = (ok: boolean, t: string) => setMsg({ ok, t });

  async function setAuto(patch: Record<string, unknown>) {
    const { ok, j } = await api("/api/settings/autonomy", patch);
    if (!ok) say(false, j.error ?? "저장하지 못했습니다.");
    reload();
  }
  async function addRoutine(e: React.FormEvent) {
    e.preventDefault();
    const { ok, j } = await api("/api/routines", { ...r, dayOfWeek: Number(r.dayOfWeek), dayOfMonth: Number(r.dayOfMonth), hour: Number(r.hour), projectId: r.projectId || null });
    say(ok, ok ? "반복 업무를 등록했습니다." : (j.error ?? "등록하지 못했습니다."));
    if (ok) setR({ ...r, title: "", instruction: "" });
    reload();
  }
  async function routineAct(id: string, act: "run" | "update" | "delete", body: unknown = {}) {
    const { ok, j } = await api<{ result?: string }>(`/api/routines/${id}/${act}`, body);
    if (act === "run") say(ok, ok ? (j.result === "queued" ? "업무를 만들었습니다." : "제안으로 올렸습니다.") : (j.error ?? "실패"));
    reload();
  }
  async function backup() {
    const res = await fetch("/api/backup");
    const j = await res.json();
    if (!res.ok) return say(false, j.error ?? "백업하지 못했습니다.");
    try {
      await saveFile(`ai-company-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(j));
      say(true, "백업 파일을 저장했습니다.");
    } catch (e) {
      say(false, `저장하지 않았습니다: ${(e as { message?: string }).message ?? e}`);
    }
  }
  async function pickRestore(file: File | undefined) {
    if (!file) return;
    try {
      setRestoreArmed(JSON.parse(await file.text()));
      say(true, `${file.name}을(를) 읽었습니다. 아래 '복원 실행'을 누르면 지금 기록이 모두 이 백업으로 바뀝니다.`);
    } catch {
      say(false, "JSON 파일을 읽지 못했습니다.");
    }
  }
  async function restore() {
    const { ok, j } = await api("/api/backup/restore", restoreArmed);
    setRestoreArmed(null);
    say(ok, ok ? "복원했습니다." : (j.error ?? "복원하지 못했습니다."));
    reload();
  }

  return (
    <Modal label="설정" onClose={close} wide>
      {msg && <p className={`mb-3 rounded-sm p-2 text-[12px] ${msg.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{msg.t}</p>}

      <section className="space-y-2">
        <h3 className="pixel text-[13px]">운영 모드</h3>
        <div className="grid gap-2 sm:grid-cols-3">
          {MODES.map((m) => (
            <label key={m.id} className={`cursor-pointer rounded-sm border-2 p-2 ${a?.mode === m.id ? "border-hi" : "border-line"}`}>
              <input type="radio" name="autonomy" className="mr-1" checked={a?.mode === m.id} onChange={() => setAuto({ mode: m.id })} />
              <b className="pixel">{m.label}</b>
              <span className="mt-1 block text-[12px] text-muted">{m.desc}</span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[12px]">
          <label className="flex items-center gap-1">
            자동 실행 하루 한도
            <input aria-label="하루 한도" type="number" min={0} max={50} defaultValue={a?.dailyAutoLimit} onBlur={(e) => setAuto({ dailyAutoLimit: Number(e.target.value) })} className="w-16 rounded-sm border-2 border-line bg-panel-2 px-1" />건
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={!!a?.proposalsFromReports} onChange={(e) => setAuto({ proposalsFromReports: e.target.checked })} /> 보고서의 다음 추천 업무를 제안으로 받기 (최대 2건)
          </label>
        </div>
        <p className="text-[11px] text-muted">
          {health?.lite
            ? "링크 버전은 서버가 없어 이 페이지가 열려 있을 때만 반복 업무를 확인합니다. 업무는 붙여넣기 방식으로 만들어집니다."
            : "PC 버전은 실행기(워커)가 30초마다 반복 업무를 확인합니다. 브라우저를 닫아도 실행기가 켜져 있으면 계속됩니다. 비용 한도는 AI_DAILY_BUDGET_USD가 따로 지킵니다."}
        </p>
      </section>

      <section className="mt-5 space-y-2">
        <h3 className="pixel text-[13px]">반복 업무 (대표가 미리 승인한 범위)</h3>
        <ul className="space-y-1" data-testid="routines">
          {data?.routines.map((x) => (
            <li key={x.id} className={`flex flex-wrap items-center gap-2 rounded-sm border border-line p-2 ${x.enabled ? "" : "opacity-50"}`}>
              <span className="min-w-0 flex-1">
                <b>{x.title}</b> <span className="text-muted">· {EMPLOYEE_BY_ID[x.employeeId]?.name} · {x.frequency === "daily" ? "매일" : x.frequency === "weekly" ? `매주 ${DOW[x.dayOfWeek ?? 1]}` : `매월 ${x.dayOfMonth}일`} {x.hour}시 · {x.executionMode === "api" ? "API" : "붙여넣기"}</span>
                <span className="block text-[11px] text-muted">다음 확인: {new Date(x.nextRunAt).toLocaleString("ko-KR")}</span>
              </span>
              <button type="button" className={btnCls} onClick={() => routineAct(x.id, "run")}>
                지금 실행
              </button>
              <button type="button" className={btnCls} onClick={() => routineAct(x.id, "update", { enabled: !x.enabled })}>
                {x.enabled ? "끄기" : "켜기"}
              </button>
              <button type="button" className={btnCls} onClick={() => routineAct(x.id, "delete")}>
                삭제
              </button>
            </li>
          ))}
          {!data?.routines.length && <li className="text-[12px] text-muted">등록된 반복 업무가 없습니다.</li>}
        </ul>
        <form onSubmit={addRoutine} className="grid gap-2 rounded-sm border-2 border-dashed border-line p-3 sm:grid-cols-4">
          <select aria-label="반복 담당" value={r.employeeId} onChange={(e) => setR({ ...r, employeeId: e.target.value })} className={inputCls}>
            {EMPLOYEES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.title}
              </option>
            ))}
          </select>
          <input aria-label="반복 이름" value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} placeholder="이름 (예: 주간 지출 점검)" className={`${inputCls} sm:col-span-3`} />
          <textarea aria-label="반복 업무 내용" value={r.instruction} onChange={(e) => setR({ ...r, instruction: e.target.value })} rows={2} placeholder="매번 지시할 내용" className={`${inputCls} sm:col-span-4`} />
          <select aria-label="반복 유형" value={r.type} onChange={(e) => setR({ ...r, type: e.target.value })} className={inputCls}>
            {TASK_TYPES.filter((t) => t.supported && !t.upload).map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          <select aria-label="반복 주기" value={r.frequency} onChange={(e) => setR({ ...r, frequency: e.target.value })} className={inputCls}>
            <option value="daily">매일</option>
            <option value="weekly">매주</option>
            <option value="monthly">매월</option>
          </select>
          {r.frequency === "weekly" && (
            <select aria-label="요일" value={r.dayOfWeek} onChange={(e) => setR({ ...r, dayOfWeek: e.target.value })} className={inputCls}>
              {DOW.map((d, i) => (
                <option key={i} value={i}>
                  {d}요일
                </option>
              ))}
            </select>
          )}
          {r.frequency === "monthly" && <input aria-label="날짜" type="number" min={1} max={28} value={r.dayOfMonth} onChange={(e) => setR({ ...r, dayOfMonth: e.target.value })} className={inputCls} />}
          <select aria-label="시각" value={r.hour} onChange={(e) => setR({ ...r, hour: e.target.value })} className={inputCls}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {h}시
              </option>
            ))}
          </select>
          <select aria-label="반복 프로젝트" value={r.projectId} onChange={(e) => setR({ ...r, projectId: e.target.value })} className={inputCls}>
            <option value="">프로젝트 없음</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select aria-label="반복 실행 방식" value={r.executionMode} onChange={(e) => setR({ ...r, executionMode: e.target.value })} className={inputCls}>
            <option value="manual">붙여넣기 (무료)</option>
            <option value="api" disabled={!apiReady && !!health?.lite}>
              API 자동 (키가 없으면 붙여넣기로 대체)
            </option>
          </select>
          <button type="submit" disabled={!r.title.trim() || !r.instruction.trim()} className={`${primaryCls} sm:col-span-2`}>
            반복 업무 등록
          </button>
        </form>
      </section>

      <section className="mt-5 space-y-2">
        <h3 className="pixel text-[13px]">백업</h3>
        <p className="text-[12px] text-muted">모든 기록(업무, 보고서, 회의, 대화, 재무, 설정)을 JSON 파일 하나로 저장합니다.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={backup} className={primaryCls}>
            백업 파일 저장
          </button>
          {health?.lite ? (
            <>
              <label className={`${btnCls} cursor-pointer`}>
                백업에서 복원…
                <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => pickRestore(e.target.files?.[0])} aria-label="백업 파일 선택" />
              </label>
              {restoreArmed != null && (
                <button type="button" onClick={restore} className="pixel rounded-sm bg-bad px-3 py-1.5 text-[13px] font-bold text-void">
                  복원 실행 (지금 기록을 덮어씀)
                </button>
              )}
            </>
          ) : (
            <span className="text-[12px] text-muted">복원: 앱을 끈 뒤 터미널에서 npm run db:restore -- 백업파일.json</span>
          )}
        </div>
      </section>
    </Modal>
  );
}
