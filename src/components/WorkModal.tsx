"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEES, EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import { routeTask } from "@/domain/routing";
import { textAttachment, type Attachment } from "@/domain/attachments";
import { useSample } from "@/lib/claudeSample";
import { AttachmentPicker } from "./AttachmentPicker";
import { Modal } from "./Modal";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: string;
  employeeId: string;
  projectId: string | null;
  executionMode: string;
  statusMessage: string | null;
  error: string | null;
  meetingId: string | null;
  createdAt: number;
  updatedAt: number;
}
interface Board {
  active: TaskRow[];
  approvals: TaskRow[];
  failed: TaskRow[];
  undecided: { id: string; title: string; endedAt: number | null; projectId: string | null }[];
}
interface ReportRow {
  id: string;
  title: string;
  employeeId: string;
  projectId: string | null;
  meetingId: string | null;
  createdAt: number;
  summary: string;
}
interface Usage {
  today: { usd: number; calls: number; tokens: number };
  month: { usd: number; calls: number; tokens: number };
  isEstimate: boolean;
  byEmployee: { employeeId: string; usd: number; calls: number }[];
  byDay: { day: string; usd: number; calls: number; claude: number }[];
  claudeAuto: { today: number; month: number };
  dailyBudgetUsd: number;
}

type Tab = "active" | "decide" | "results" | "cost";
const when = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const btn = "pixel rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[12px] hover:border-hi disabled:opacity-40";

/** 업무 보기: tell anyone to do anything from one box, and see everything that needs you in one place. */
export function WorkModal({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const open = useOffice((s) => s.panel === "work");
  const close = () => useOffice.getState().setPanel(null);
  const lastEvent = useOffice((s) => s.liveEvents[0]?.id);
  const sample = useSample();
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;
  const claude = typeof sample === "function";

  const [tab, setTab] = useState<Tab>("active");
  const [board, setBoard] = useState<Board | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [q, setQ] = useState("");
  const [fProject, setFProject] = useState("");
  const [fEmp, setFEmp] = useState("");

  // command bar
  const [text, setText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [override, setOverride] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const route = useMemo(() => routeTask(text), [text]);
  const assignee = override || route.employeeId;

  const loadBoard = useCallback(async () => setBoard(await fetch("/api/work/board").then((r) => r.json())), []);
  const loadReports = useCallback(async () => {
    const p = new URLSearchParams({ q, projectId: fProject, employeeId: fEmp });
    setReports((await fetch(`/api/work/reports?${p}`).then((r) => r.json())).reports ?? []);
  }, [q, fProject, fEmp]);
  const loadUsage = useCallback(async () => setUsage(await fetch("/api/work/usage").then((r) => r.json())), []);

  useEffect(() => {
    if (!open) return;
    void loadBoard();
    if (tab === "results") void loadReports();
    if (tab === "cost") void loadUsage();
  }, [open, tab, lastEvent, loadBoard, loadReports, loadUsage]);
  useEffect(() => {
    if (open) setTimeout(() => boxRef.current?.focus(), 50);
  }, [open]);

  if (!open) return null;

  async function give(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg(null);
    const type = override ? (override === route.employeeId ? route.type : "GENERAL") : route.type;
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: assignee, instruction: text, type, projectId: projectId || null, executionMode: apiReady ? "api" : "manual", attachments }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, t: j.error ?? "업무를 만들지 못했습니다." });
      return;
    }
    setMsg({ ok: true, t: `${EMPLOYEE_BY_ID[assignee].name}에게 맡겼습니다${apiReady ? " (API 자동 실행)" : claude ? " (Claude가 바로 작성합니다)" : " (붙여넣기 창이 열립니다)"}.` });
    setText("");
    setAttachments([]);
    setOverride("");
    reload();
    void loadBoard();
    if (!apiReady) useOffice.getState().openManual(j.task.id, true);
  }

  const openTask = (t: TaskRow) => {
    if (t.meetingId) return useOffice.getState().openMeeting(t.meetingId);
    if (t.executionMode === "manual" && t.status === "QUEUED") return useOffice.getState().openManual(t.id);
    toGameSelect(t.employeeId);
  };
  const toGameSelect = (id: string) => {
    close();
    void import("@/game/bridge").then(({ toGame }) => toGame.emit("select", id));
  };
  const act = async (url: string) => {
    await fetch(url, { method: "POST" });
    reload();
    void loadBoard();
  };

  const counts = { active: board?.active.length ?? 0, decide: (board?.approvals.length ?? 0) + (board?.undecided.length ?? 0) + (board?.failed.length ?? 0) };
  const projName = (id: string | null) => data?.projects.find((p) => p.id === id)?.name;

  const taskLine = (t: TaskRow, actions: React.ReactNode) => (
    <li key={t.id} className="flex flex-wrap items-center gap-2 rounded-sm border border-line bg-panel-2 p-2 text-[13px]">
      <span className="pixel shrink-0 rounded-sm px-1.5 text-[12px]" style={{ color: EMPLOYEE_BY_ID[t.employeeId]?.look.accent }}>
        {EMPLOYEE_BY_ID[t.employeeId]?.name}
      </span>
      <span className="min-w-0 flex-1 truncate" title={t.title}>
        {t.title}
      </span>
      {projName(t.projectId) && <span className="shrink-0 text-[11px] text-muted">{projName(t.projectId)}</span>}
      <span className={`pixel shrink-0 text-[12px] ${t.status === "FAILED" ? "text-bad" : t.status === "RUNNING" ? "text-ok" : "text-hi"}`}>
        {t.executionMode === "manual" && t.status === "QUEUED" ? "답 기다리는 중" : TASK_STATUS_LABEL[t.status as TaskStatus]}
      </span>
      <span className="flex shrink-0 gap-1">{actions}</span>
      {t.error && <span className="w-full text-[12px] text-bad">{t.error}</span>}
    </li>
  );

  return (
    <Modal label="업무 보기" onClose={close} wide>
      <form ref={formRef} onSubmit={give} className="space-y-2 rounded-md border-2 border-hi/60 bg-panel-2 p-3" data-testid="command-bar">
        <label className="pixel block text-[14px] font-bold">⚡ 무엇을 시킬까요?</label>
        <textarea
          ref={boxRef}
          id="work-command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) formRef.current?.requestSubmit();
          }}
          rows={3}
          placeholder="예: Number Maze MEMORY 모드 출시 전 점검표 만들어 줘 / 공모전 기획서 3장 초안 / 경쟁 게임 5개 조사"
          className="w-full resize-y rounded-sm border-2 border-line bg-panel px-2 py-1.5 text-[14px] focus:border-hi focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-muted">담당</span>
          <select value={assignee} onChange={(e) => setOverride(e.target.value)} aria-label="담당 직원" className="rounded-sm border-2 border-line bg-panel px-2 py-1">
            {EMPLOYEES.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.titleKo}
              </option>
            ))}
          </select>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="프로젝트" className="rounded-sm border-2 border-line bg-panel px-2 py-1">
            <option value="">프로젝트 없음</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={busy || !text.trim()} className="pixel ml-auto rounded-sm bg-hi px-4 py-1.5 text-[14px] font-bold text-void disabled:opacity-40">
            {busy ? "맡기는 중…" : "지시하기"}
          </button>
        </div>
        {text.trim() && (
          <p className="text-[12px] text-muted" data-testid="routing-reason">
            자동 배정: {override ? "직접 고름" : route.reason}
            {projectId ? " · 이 프로젝트의 최근 결정과 결과를 AI에게 자동으로 함께 보냅니다" : ""} ·{" "}
            <button type="button" className="underline" onClick={() => (useOffice.getState().startMeetingWith(text), close())}>
              여러 부서 의견이 필요하면 회의로
            </button>
          </p>
        )}
        <AttachmentPicker value={attachments} onChange={setAttachments} compact dropRef={formRef} />
        {msg && <p className={`text-[13px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
      </form>

      <div className="mt-3 flex flex-wrap gap-1" role="tablist">
        {(
          [
            ["active", `진행 중 ${counts.active}`],
            ["decide", `결정·승인·실패 ${counts.decide}`],
            ["results", "결과물 보관함"],
            ["cost", "사용량·비용"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`pixel rounded-sm border-2 px-3 py-1 text-[13px] ${tab === k ? "border-hi bg-hi font-bold text-void" : "border-line bg-panel-2 hover:border-hi"}`}
          >
            {l}
          </button>
        ))}
      </div>

      <div className="mt-2" data-testid={`work-tab-${tab}`}>
        {tab === "active" &&
          (board?.active.length ? (
            <ul className="space-y-1">
              {board.active.map((t) =>
                taskLine(
                  t,
                  <>
                    <button type="button" className={btn} onClick={() => openTask(t)}>
                      {t.executionMode === "manual" && t.status === "QUEUED" ? (claude ? "⚡ 처리" : "붙여넣기") : "보기"}
                    </button>
                    <button type="button" className={btn} onClick={() => act(`/api/tasks/${t.id}/cancel`)}>
                      취소
                    </button>
                  </>,
                ),
              )}
            </ul>
          ) : (
            <p className="p-2 text-[13px] text-muted">진행 중인 업무가 없습니다. 위 칸에 지시해 보세요.</p>
          ))}

        {tab === "decide" && (
          <div className="space-y-3">
            {!!board?.undecided.length && (
              <section>
                <h3 className="pixel mb-1 text-[13px] text-hi">결정을 기다리는 회의</h3>
                <ul className="space-y-1">
                  {board.undecided.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 rounded-sm border border-line bg-panel-2 p-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{m.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{when(m.endedAt)}</span>
                      <button type="button" className={btn} onClick={() => useOffice.getState().openMeeting(m.id)}>
                        결정하기
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {!!board?.approvals.length && (
              <section>
                <h3 className="pixel mb-1 text-[13px] text-hi">승인 요청 (승인해야 실행됩니다)</h3>
                <ul className="space-y-1">
                  {board.approvals.map((t) =>
                    taskLine(
                      t,
                      <>
                        <button type="button" className={btn} onClick={() => act(`/api/tasks/${t.id}/approve`)}>
                          승인
                        </button>
                        <button type="button" className={btn} onClick={() => act(`/api/tasks/${t.id}/reject`)}>
                          거절
                        </button>
                      </>,
                    ),
                  )}
                </ul>
              </section>
            )}
            {!!board?.failed.length && (
              <section>
                <h3 className="pixel mb-1 text-[13px] text-bad">최근 7일 실패</h3>
                <ul className="space-y-1">
                  {board.failed.map((t) =>
                    taskLine(
                      t,
                      <button type="button" className={btn} onClick={() => act(`/api/tasks/${t.id}/retry`)}>
                        다시 시도
                      </button>,
                    ),
                  )}
                </ul>
              </section>
            )}
            {!counts.decide && <p className="p-2 text-[13px] text-muted">대표가 결정하거나 승인할 일이 없습니다.</p>}
          </div>
        )}

        {tab === "results" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목·내용 검색" aria-label="결과물 검색" className="min-w-40 flex-1 rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[13px]" />
              <select value={fProject} onChange={(e) => setFProject(e.target.value)} aria-label="프로젝트 필터" className="rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[13px]">
                <option value="">모든 프로젝트</option>
                {data?.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select value={fEmp} onChange={(e) => setFEmp(e.target.value)} aria-label="직원 필터" className="rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[13px]">
                <option value="">모든 직원</option>
                {EMPLOYEES.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            {reports === null ? (
              <p className="text-muted">불러오는 중…</p>
            ) : !reports.length ? (
              <p className="p-2 text-[13px] text-muted">조건에 맞는 결과물이 없습니다.</p>
            ) : (
              <ul className="space-y-1" data-testid="results">
                {reports.map((r) => (
                  <li key={r.id} className="rounded-sm border border-line bg-panel-2 p-2 text-[13px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pixel shrink-0" style={{ color: EMPLOYEE_BY_ID[r.employeeId]?.look.accent }}>
                        {EMPLOYEE_BY_ID[r.employeeId]?.name}
                      </span>
                      <button type="button" className="min-w-0 flex-1 truncate text-left font-bold hover:text-hi" onClick={() => (close(), useOffice.getState().openReport(r.id))}>
                        {r.title}
                      </button>
                      <span className="shrink-0 text-[11px] text-muted">
                        {projName(r.projectId) ? `${projName(r.projectId)} · ` : ""}
                        {when(r.createdAt)}
                      </span>
                      <button
                        type="button"
                        className={btn}
                        onClick={async () => {
                          const full = await fetch(`/api/reports/${r.id}`).then((x) => x.json());
                          close();
                          useOffice.getState().openChat(r.employeeId, textAttachment(`보고서: ${r.title}`, full.report?.body ?? r.summary));
                        }}
                      >
                        💬 질문
                      </button>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{r.summary}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === "cost" && usage && (
          <div className="space-y-3 text-[13px]">
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-sm border border-line bg-panel-2 p-3">
                <div className="text-[12px] text-muted">오늘 API 비용</div>
                <div className="pixel text-[20px] font-bold tabular-nums">${usage.today.usd.toFixed(2)}</div>
                <div className="text-[12px] text-muted">
                  {usage.today.calls}회 호출{usage.dailyBudgetUsd > 0 ? ` · 하루 한도 $${usage.dailyBudgetUsd}` : ""}
                </div>
              </div>
              <div className="rounded-sm border border-line bg-panel-2 p-3">
                <div className="text-[12px] text-muted">이번 달 API 비용</div>
                <div className="pixel text-[20px] font-bold tabular-nums">${usage.month.usd.toFixed(2)}</div>
                <div className="text-[12px] text-muted">
                  {usage.month.calls}회 · 토큰 {usage.month.tokens.toLocaleString()}
                  {usage.isEstimate ? " (가격표 기준 추정)" : ""}
                </div>
              </div>
              <div className="rounded-sm border border-line bg-panel-2 p-3">
                <div className="text-[12px] text-muted">Claude 자동 실행 (오늘 / 이번 달)</div>
                <div className="pixel text-[20px] font-bold tabular-nums">
                  {usage.claudeAuto.today} / {usage.claudeAuto.month}회
                </div>
                <div className="text-[12px] text-muted">claude.ai 요금제 사용량이라 토큰·금액은 앱이 알 수 없습니다</div>
              </div>
            </div>
            <section>
              <h3 className="pixel mb-1 text-[13px]">최근 14일</h3>
              <div className="flex h-28 items-end gap-1 rounded-sm border border-line bg-panel-2 p-2" aria-label="최근 14일 실행 수">
                {usage.byDay.map((d) => {
                  const max = Math.max(1, ...usage.byDay.map((x) => x.calls + x.claude));
                  const n = d.calls + d.claude;
                  return (
                    <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-0.5" title={`${d.day}: API ${d.calls}회 $${d.usd.toFixed(2)} · Claude 자동 ${d.claude}회`}>
                      <div className="w-full rounded-t-sm bg-hi" style={{ height: `${(n / max) * 80}px`, minHeight: n ? 3 : 0 }} />
                      <span className="text-[9px] text-muted">{d.day.slice(8)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
            {!!usage.byEmployee.length && (
              <section>
                <h3 className="pixel mb-1 text-[13px]">이번 달 직원별 API 비용</h3>
                <ul className="space-y-0.5">
                  {usage.byEmployee.map((e) => (
                    <li key={e.employeeId} className="flex justify-between rounded-sm bg-panel-2 px-2 py-1">
                      <span>{EMPLOYEE_BY_ID[e.employeeId]?.name ?? "기타"}</span>
                      <span className="tabular-nums">
                        ${e.usd.toFixed(2)} · {e.calls}회
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
