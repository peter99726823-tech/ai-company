"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useOffice } from "@/store/officeStore";
import { toGame, type Destination } from "@/game/bridge";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { ACTIVITIES, ACTIVITY_LABEL, TASK_STATUS_LABEL, type Activity, type TaskStatus } from "@/domain/types";
import { TASK_TYPES, DEFAULT_TYPE_FOR, TASK_TYPE_BY_ID } from "@/domain/taskTypes";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import { AttachmentPicker } from "./AttachmentPicker";
import type { Attachment } from "@/domain/attachments";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

const PREVIEW_DEST: Record<Activity, Destination> = {
  idle: "desk",
  walk: "stay",
  working: "desk",
  thinking: "desk",
  meeting: "meeting",
  reporting: "report",
  resting: "lounge",
  error: "stay",
  waiting: "report",
};

export function EmployeePanel({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const id = useOffice((s) => s.selectedId);
  const actor = useOffice((s) => (id ? s.actors[id] : undefined));
  const openReport = useOffice((s) => s.openReport);
  const [tab, setTab] = useState<"info" | "order">("info");
  const [instruction, setInstruction] = useState("");
  const [projectId, setProjectId] = useState("");
  const [type, setType] = useState("GENERAL");
  const [execMode, setExecMode] = useState<"api" | "manual">("manual");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const orderForm = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  const profile = id ? EMPLOYEE_BY_ID[id] : null;
  const portrait = useMemo(() => (profile ? portraitDataUrl(profile.look, 4) : ""), [profile]);
  useEffect(() => {
    setTab("info");
    setInstruction("");
    setNotice(null);
    if (id) setType(DEFAULT_TYPE_FOR[id] ?? "GENERAL");
  }, [id]);
  useEffect(() => {
    setExecMode(health?.worker.running && health?.ai.keyConfigured ? "api" : "manual");
  }, [health?.worker.running, health?.ai.keyConfigured]);

  if (!profile || !id) return null;
  const mine = data?.byEmployee?.[id];
  const active = mine?.activeTask ?? null;
  const last = mine?.lastFinished ?? null;
  const workerOn = !!health?.worker.running;
  const apiReady = workerOn && !!health?.ai.keyConfigured;
  const openManual = useOffice.getState().openManual;
  const typeDef = TASK_TYPE_BY_ID[type];

  async function post(url: string, body?: unknown) {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    const { ok, j } = await post("/api/tasks", { employeeId: id, instruction, type, projectId: projectId || null, executionMode: execMode, attachments });
    setBusy(false);
    if (!ok) {
      setNotice({ tone: "bad", text: j.error ?? "업무를 등록하지 못했습니다." });
      return;
    }
    setInstruction("");
    setAttachments([]);
    setNotice({
      tone: "ok",
      text:
        execMode === "manual"
          ? "업무를 등록했습니다. 지시문을 claude.ai에 붙여넣고 답을 가져오세요."
          : workerOn
            ? "업무를 등록했습니다. 실행기가 곧 시작합니다."
            : "업무를 등록했습니다. 실행기가 꺼져 있어 켜질 때까지 대기합니다.",
    });
    setTab("info");
    reload();
    if (execMode === "manual") openManual(j.task.id);
  }

  async function act(url: string, body?: unknown) {
    const { ok, j } = await post(url, body);
    setNotice({ tone: ok ? "ok" : "bad", text: j.message ?? j.error ?? (ok ? "처리했습니다." : "처리하지 못했습니다.") });
    reload();
  }

  return (
    <aside
      className="px-frame scroll-thin absolute inset-x-2 bottom-2 z-10 max-h-[70%] overflow-y-auto rounded-md bg-panel/95 backdrop-blur md:inset-x-auto md:bottom-auto md:right-2 md:top-2 md:max-h-[calc(100%-16px)] md:w-[360px]"
      aria-label={`${profile.name} 상세`}
    >
      <div className="flex items-start gap-3 border-b-2 border-line p-3" style={{ boxShadow: `inset 0 3px 0 ${profile.look.accent}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={portrait} alt="" width={64} height={96} className="pixelated shrink-0 rounded-sm bg-panel-2" />
        <div className="min-w-0 flex-1">
          <div className="pixel text-[17px] font-bold">{profile.name}</div>
          <div className="pixel text-[12px]" style={{ color: profile.look.accent }}>
            {profile.title}
          </div>
          <div className="text-[12px] text-muted">{profile.titleKo}</div>
          <div className="pixel mt-1 text-[11px] text-muted">
            {actor?.roomName ?? ""} · 명령어 <span className="text-ink">{profile.command}</span>
          </div>
        </div>
        <button type="button" onClick={() => toGame.emit("select", null)} className="pixel rounded-sm px-2 text-muted hover:text-ink" aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="flex gap-1 border-b-2 border-line px-3 pt-2">
        {(["info", "order"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`pixel -mb-[2px] rounded-t-sm border-2 border-b-0 px-3 py-1 text-[12px] ${tab === t ? "border-line bg-panel-2 text-ink" : "border-transparent text-muted"}`}
          >
            {t === "info" ? "정보" : "업무 지시"}
          </button>
        ))}
      </div>

      {notice && <p className={`mx-3 mt-2 rounded-sm p-2 text-[12px] ${notice.tone === "ok" ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{notice.text}</p>}

      {tab === "info" ? (
        <div className="space-y-3 p-3 text-[13px]">
          <Section title="진행 중인 업무">
            {active ? (
              <div className="space-y-1.5 rounded-sm border border-line bg-panel-2 p-2" data-testid="active-task">
                <div className="font-medium leading-snug">{active.title}</div>
                <div className="flex items-center justify-between gap-2">
                  <span className="pixel text-[11px] text-info">{TASK_STATUS_LABEL[active.status as TaskStatus]}</span>
                  <span className="pixel text-[11px] text-muted tabular-nums">{active.progress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <i className="block h-full bg-ok transition-[width] duration-500" style={{ width: `${active.progress}%` }} />
                </div>
                <div className="text-[12px] text-muted">{active.statusMessage}</div>
                {active.status === "WAITING_APPROVAL" && (
                  <span className="mr-2 inline-flex gap-1">
                    <button type="button" onClick={() => act(`/api/tasks/${active.id}/approve`, { executionMode: apiReady ? "api" : "manual" })} className="pixel rounded-sm bg-hi px-2 py-0.5 text-[11px] font-bold text-void">
                      제안 승인
                    </button>
                    <button type="button" onClick={() => act(`/api/tasks/${active.id}/reject`)} className="pixel rounded-sm border border-line px-2 py-0.5 text-[11px]">
                      거절
                    </button>
                  </span>
                )}
                {active.executionMode === "manual" && active.status === "QUEUED" ? (
                  <button type="button" onClick={() => (active.meetingId ? useOffice.getState().openMeeting(active.meetingId) : openManual(active.id))} className="pixel mr-2 rounded-sm bg-hi px-2 py-0.5 text-[11px] font-bold text-void">
                    {active.meetingId ? "회의실 열기" : "붙여넣기로 처리"}
                  </button>
                ) : (
                  !workerOn && active.status === "QUEUED" && <p className="text-[12px] text-warn">실행기가 꺼져 있어 시작되지 않았습니다.</p>
                )}
                <button type="button" onClick={() => act(`/api/tasks/${active.id}/cancel`)} className="pixel rounded-sm border border-line px-2 py-0.5 text-[11px] text-muted hover:text-bad">
                  {active.cancelRequested ? "취소 요청됨" : "업무 취소"}
                </button>
              </div>
            ) : (
              <p className="text-muted">없음</p>
            )}
          </Section>

          {last?.status === "FAILED" && (
            <Section title="최근 실패">
              <div className="space-y-1.5 rounded-sm border border-bad/40 bg-bad/5 p-2" data-testid="failed-task">
                <div className="font-medium leading-snug">{last.title}</div>
                <p className="text-[12px] text-bad">{last.error}</p>
                <button type="button" onClick={() => act(`/api/tasks/${last.id}/retry`)} className="pixel rounded-sm border border-line px-2 py-0.5 text-[11px] hover:border-hi">
                  다시 실행
                </button>
              </div>
            </Section>
          )}

          <Section title="최근 완료한 업무">
            {mine?.recentCompleted.length ? (
              <ul className="space-y-1">
                {mine.recentCompleted.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    {t.reportId && (
                      <button type="button" onClick={() => openReport(t.reportId)} className="pixel shrink-0 rounded-sm bg-panel-2 px-2 py-0.5 text-[11px] text-hi hover:bg-line">
                        보고서
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">아직 없습니다.</p>
            )}
          </Section>

          <Section title="캐릭터 상태">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pixel rounded-sm bg-panel-2 px-2 py-0.5 text-[12px]">{actor ? ACTIVITY_LABEL[actor.activity] : "–"}</span>
              {actor?.mode === "preview" && <span className="pixel rounded-sm bg-warn/20 px-2 py-0.5 text-[11px] text-warn">애니메이션 미리보기 중</span>}
            </div>
            <p className="mt-1 text-[12px] text-muted">캐릭터 동작은 서버의 업무 상태를 보여주는 화면입니다. 기준은 위의 업무 상태입니다.</p>
          </Section>

          <Section title="전문 분야">
            <div className="flex flex-wrap gap-1">
              {profile.expertise.map((x) => (
                <span key={x} className="rounded-sm border border-line px-1.5 py-0.5 text-[12px] text-muted">
                  {x}
                </span>
              ))}
            </div>
          </Section>

          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => setTab("order")}>업무 지시</ActionButton>
            <ActionButton onClick={() => toGame.emit("follow", id)}>카메라 따라가기</ActionButton>
            <ActionButton onClick={() => useOffice.getState().openChat(id)}>대화하기</ActionButton>
            <ActionButton disabled={!mine?.recentCompleted[0]?.reportId} onClick={() => openReport(mine?.recentCompleted[0]?.reportId ?? null)}>
              보고서 {mine?.reportCount ?? 0}건
            </ActionButton>
          </div>

          <details className="rounded-sm border border-dashed border-line p-2">
            <summary className="pixel cursor-pointer text-[12px] text-muted">개발자 도구 · 애니메이션 미리보기</summary>
            <p className="mt-2 text-[12px] text-warn">미리보기는 캐릭터 동작 확인용이며 실제 업무가 아닙니다.</p>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {ACTIVITIES.filter((a) => a !== "walk").map((a) => (
                <button
                  key={a}
                  type="button"
                  className="pixel rounded-sm bg-panel-2 px-1 py-1 text-[11px] hover:text-hi"
                  onClick={() => toGame.emit("command", { id, go: PREVIEW_DEST[a], activity: a, bubble: `미리보기 · ${ACTIVITY_LABEL[a]}`, source: "preview" })}
                >
                  {ACTIVITY_LABEL[a]}
                </button>
              ))}
            </div>
            <button type="button" className="pixel mt-2 w-full rounded-sm border border-line py-1 text-[11px] text-muted hover:text-ink" onClick={() => toGame.emit("release", id)}>
              미리보기 끝내기
            </button>
          </details>
        </div>
      ) : (
        <form ref={orderForm} className="space-y-2 p-3 text-[13px]" onSubmit={submit} data-testid="order-form">
          <label className="block">
            <span className="pixel text-[12px] text-muted">업무 유형</span>
            <select id="order-type" value={type} onChange={(e) => setType(e.target.value)} className="mt-1 w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5">
              {TASK_TYPES.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.supported}>
                  {t.label}
                  {t.supported ? "" : " (아직 불가)"}
                </option>
              ))}
            </select>
          </label>
          {TASK_TYPES.filter((t) => !t.supported).length > 0 && (
            <p className="text-[11px] text-muted">
              실행 불가 유형: {TASK_TYPES.filter((t) => !t.supported).map((t) => `${t.label} — ${t.needs}`).join(" / ")}
            </p>
          )}
          {typeDef?.wantsWeb && !health?.ai.webSearch && (
            <p className="rounded-sm bg-warn/10 p-2 text-[12px] text-warn">웹 검색이 꺼져 있어 최신 시장·가격 정보는 조사하지 못합니다. 보고서에 그 한계가 표시됩니다.</p>
          )}
          <fieldset className="grid grid-cols-2 gap-1">
            <legend className="pixel mb-1 text-[12px] text-muted">실행 방식</legend>
            <label className={`flex items-center gap-1.5 rounded-sm border-2 p-1.5 text-[12px] ${execMode === "manual" ? "border-hi" : "border-line"}`}>
              <input type="radio" name="exec" checked={execMode === "manual"} onChange={() => setExecMode("manual")} />
              붙여넣기 (무료)
            </label>
            <label className={`flex items-center gap-1.5 rounded-sm border-2 p-1.5 text-[12px] ${execMode === "api" ? "border-hi" : "border-line"} ${apiReady ? "" : "opacity-50"}`}>
              <input type="radio" name="exec" checked={execMode === "api"} onChange={() => setExecMode("api")} disabled={!apiReady} />
              API 자동{apiReady ? "" : " (키 필요)"}
            </label>
          </fieldset>
          <label className="block">
            <span className="pixel text-[12px] text-muted">관련 프로젝트 (정보가 자동으로 전달됩니다)</span>
            <select id="order-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5">
              <option value="">선택 안 함</option>
              {data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          {typeDef?.meeting && (
            <button type="button" onClick={() => useOffice.getState().startMeetingWith(instruction)} className="pixel w-full rounded-sm border-2 border-hi py-1.5 text-[12px] text-hi">
              회의 소집으로 진행하기
            </button>
          )}
          <label className="block">
            <span className="pixel text-[12px] text-muted">{profile.name}에게 지시할 업무</span>
            <textarea
              id="order-text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={6}
              placeholder="예: Number Maze라는 퍼즐 게임의 수익화 전략을 분석하고 장단점을 보고서로 작성해줘."
              className="mt-1 w-full resize-y rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
            />
          </label>
          <AttachmentPicker value={attachments} onChange={setAttachments} dropRef={orderForm} />
          {typeDef?.upload && !attachments.length && <p className="text-[11px] text-warn">계약서 파일(.txt .md .pdf)을 첨부해 주세요. 한글·워드 파일은 본문을 복사해 붙여넣으세요.</p>}
          <button type="submit" disabled={busy || !instruction.trim() || !typeDef?.supported} className="pixel w-full rounded-sm bg-hi py-2 text-[13px] font-bold text-void disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? "등록 중…" : "업무 지시하기"}
          </button>
          <p className="text-[11px] leading-relaxed text-muted">
            {execMode === "manual"
              ? "등록하면 지시문이 만들어집니다. claude.ai에 붙여넣고 받은 답을 다시 붙여넣으면 보고서로 저장됩니다. API 비용은 들지 않습니다."
              : `실행기가 Claude(${health?.ai.model ?? "–"})로 처리합니다. 실패하면 실제 오류가 그대로 표시되며 결과를 지어내지 않습니다.`}
          </p>
        </form>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="pixel mb-1 text-[11px] uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function ActionButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className="pixel rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5 text-[12px] hover:border-hi disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
    >
      {children}
    </button>
  );
}
