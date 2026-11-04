"use client";

import { md } from "@/lib/markdown";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import { ManualRun } from "./ManualRun";
import { ExportButtons } from "./ExportButtons";
import { textAttachment } from "@/domain/attachments";
import { useSample } from "@/lib/claudeSample";
import type { Health } from "@/hooks/useOfficeData";

interface MeetingData {
  meeting: { id: string; topic: string; status: string; decision: string | null; createdAt: number; endedAt: number | null };
  participants: { employeeId: string; order: number; statement: string | null }[];
  task: { id: string; status: string; executionMode: string; statusMessage: string | null; error: string | null; progress: number } | null;
  report: { id: string; body: string; nextTasks: string | null } | null;
  followUps?: { id: string; employeeId: string; title: string; status: string; executionMode: string; reportId: string | null }[];
}


/** A long, Markdown agenda pasted as the topic: show its first line as the title. */
function topicTitle(topic: string) {
  const first = (topic.trim().split("\n").find((l) => l.trim()) ?? "").split(/\s#{2,}\s/)[0];
  return first.replace(/^#+\s*/, "").replace(/^\[회의 안건\]\s*/, "").trim() || topic.slice(0, 80);
}

function parseOptions(summary: string) {
  const sec = /##\s*대표 결정 선택지[^\n]*\n([\s\S]*?)(?=\n##\s|$)/.exec(summary)?.[1] ?? "";
  return sec
    .split("\n")
    .map((l) => /^\s*[-*]\s*\[?([A-Z])\]?[.):]?\s*(.+)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => ({ key: x[1], text: x[2].trim() }));
}

export function MeetingModal({ health, reload }: { health: Health | null; reload: () => void }) {
  const id = useOffice((s) => s.meetingId);
  const lastEvent = useOffice((s) => s.liveEvents[0]?.id);
  const autoStart = useOffice((s) => !!s.meetingId && s.autoMeetingId === s.meetingId);
  const close = () => {
    useOffice.setState({ autoMeetingId: null });
    useOffice.getState().openMeeting(null);
  };
  const [d, setD] = useState<MeetingData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [option, setOption] = useState("");
  const [note, setNote] = useState("");
  const [follow, setFollow] = useState<Record<number, boolean>>({});
  const [followMode, setFollowMode] = useState<"batch" | "manual" | "api">("batch");
  const [autoBatch, setAutoBatch] = useState(false);
  const sample = useSample();
  const [decideMsg, setDecideMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await fetch(`/api/meetings/${id}`);
    const j = await r.json();
    if (!r.ok) setErr(j.error);
    else setD(j);
  }, [id]);

  useEffect(() => {
    setD(null);
    setErr(null);
    setOption("");
    setNote("");
    setFollow({});
    setDecideMsg(null);
    setAutoBatch(false);
    void load();
  }, [id, load]);
  useEffect(() => {
    void load();
  }, [lastEvent, load]);

  const portraits = useMemo(() => {
    if (!d) return {} as Record<string, string>;
    return Object.fromEntries(d.participants.map((p) => [p.employeeId, portraitDataUrl(EMPLOYEE_BY_ID[p.employeeId].look, 3)]));
  }, [d]);

  if (!id) return null;
  const done = d?.meeting.status === "COMPLETED";
  const followUps = d?.report?.nextTasks ? (JSON.parse(d.report.nextTasks) as { employeeId: string; instruction: string }[]) : [];
  const options = d?.report ? parseOptions(d.report.body) : [];
  const decision = d?.meeting.decision ? (JSON.parse(d.meeting.decision) as Decision) : null;
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;

  async function decide() {
    const r = await fetch(`/api/meetings/${id}/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ option, note, followUps: followUps.filter((_, i) => follow[i] ?? true), executionMode: followMode === "api" ? "api" : "manual" }),
    });
    const j = await r.json();
    if (!r.ok) {
      setDecideMsg(j.error);
      return;
    }
    setDecideMsg(`결정을 기록했습니다.${j.created.length ? ` 후속 업무 ${j.created.length}건을 등록했습니다.` : ""}`);
    if (j.created.length && followMode === "batch" && typeof sample === "function") setAutoBatch(true);
    reload();
    void load();
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={close} role="dialog" aria-modal="true" aria-label="회의실">
      <div className="px-frame flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b-2 border-line p-3">
          <div className="min-w-0 flex-1">
            <div className="pixel text-[11px] text-muted">
              회의실 · {d?.task ? TASK_STATUS_LABEL[d.task.status as TaskStatus] : ""}
              {d?.task?.executionMode === "manual" ? " · 붙여넣기 방식" : d ? " · API 자동" : ""}
            </div>
            <h2 className="pixel mt-0.5 line-clamp-2 text-[16px] font-bold leading-snug" title={d?.meeting.topic}>
              {d ? topicTitle(d.meeting.topic) : "불러오는 중…"}
            </h2>
            {d && (d.meeting.topic.trim().includes("\n") || d.meeting.topic.length > 120) && (
              <details className="mt-1" data-testid="topic-full">
                <summary className="cursor-pointer text-[11px] text-muted">안건 전체 보기 ({d.meeting.topic.length.toLocaleString()}자)</summary>
                <div className="report scroll-thin mt-1 max-h-[30vh] overflow-y-auto rounded-sm border border-line bg-panel-2 p-2 text-[12px]" dangerouslySetInnerHTML={{ __html: md(d.meeting.topic) }} />
              </details>
            )}
            <div className="mt-1 flex flex-wrap gap-1">
              {d?.participants.map((p) => (
                <span key={p.employeeId} className="pixel rounded-sm border border-line px-1.5 text-[11px]" style={{ color: EMPLOYEE_BY_ID[p.employeeId].look.accent }}>
                  {EMPLOYEE_BY_ID[p.employeeId].name}
                </span>
              ))}
            </div>
          </div>
          <button type="button" onClick={close} className="pixel rounded-sm px-2 text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>

        <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {err && <p className="text-bad">{err}</p>}

          {d?.task && !done && d.task.status === "QUEUED" && d.task.executionMode === "manual" && (
            <>
              <ManualRun taskId={d.task.id} meeting autoStart={autoStart} onDone={() => (reload(), void load())} />
              <button
                type="button"
                onClick={async () => {
                  if (!confirm("이 회의를 취소할까요? 답변을 기다리는 상태가 끝나고 목록에서 빠집니다.")) return;
                  await fetch(`/api/tasks/${d.task!.id}/cancel`, { method: "POST" });
                  reload();
                  void load();
                }}
                className="pixel text-[11px] text-muted underline hover:text-bad"
              >
                이 회의 취소 (중복으로 만든 회의 정리)
              </button>
            </>
          )}
          {d?.task && !done && d.task.executionMode === "api" && ["QUEUED", "PLANNING", "RUNNING"].includes(d.task.status) && (
            <div className="rounded-sm border border-line bg-panel-2 p-3 text-[13px]">
              <div className="pixel text-info">{d.task.statusMessage}</div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                <i className="block h-full bg-ok" style={{ width: `${d.task.progress}%` }} />
              </div>
            </div>
          )}
          {d?.task?.status === "FAILED" && <p className="rounded-sm bg-bad/10 p-2 text-[13px] text-bad">회의 실패: {d.task.error}</p>}
          {d?.task?.status === "CANCELED" && <p className="rounded-sm bg-line p-2 text-[13px] text-muted">취소된 회의입니다.</p>}

          {done && d && (
            <>
              <p className="text-[11px] text-muted">아래 발언은 AI가 한 번의 응답에서 각 부서 역할로 작성한 실제 출력입니다.</p>
              <section className="space-y-2" data-testid="statements">
                {d.participants.map((p) => {
                  const e = EMPLOYEE_BY_ID[p.employeeId];
                  return (
                    <article key={p.employeeId} className="flex gap-3 rounded-sm border border-line bg-panel-2 p-2" style={{ boxShadow: `inset 3px 0 0 ${e.look.accent}` }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={portraits[p.employeeId]} alt="" width={32} height={48} className="pixelated h-12 w-8 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="pixel text-[12px]">
                          {e.name} <span className="text-muted">· {e.title}</span>
                        </div>
                        <div className="report text-[13px]" dangerouslySetInnerHTML={{ __html: md(p.statement ?? "") }} />
                      </div>
                    </article>
                  );
                })}
              </section>
              <section className="rounded-sm border-2 border-hi/50 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="pixel flex-1 text-[13px] text-hi">CEO Advisor 종합</div>
                  <button
                    type="button"
                    onClick={() => {
                      const att = textAttachment(`회의록: ${topicTitle(d.meeting.topic)}`, minutesMarkdown(d));
                      close();
                      useOffice.getState().openChat("ceo-advisor", att);
                    }}
                    className="pixel rounded-sm bg-hi px-2 py-0.5 text-[11px] font-bold text-void"
                  >
                    💬 이 회의로 대화
                  </button>
                  <ExportButtons title={topicTitle(d.meeting.topic)} markdown={() => minutesMarkdown(d)} />
                </div>
                <div className="report text-[13px]" dangerouslySetInnerHTML={{ __html: md(d.report?.body ?? "") }} />
              </section>

              <section className="rounded-sm border border-line bg-panel-2 p-3" data-testid="decision">
                <div className="pixel mb-2 text-[13px]">대표 결정</div>
                {decision ? (
                  <div className="space-y-2">
                    <p className="text-[13px]">
                      결정함: <b>{decision.option}</b>
                      {decision.note && ` — ${decision.note}`}
                    </p>
                    <FollowUpRun d={d} decision={decision} autoStart={autoBatch} onDone={() => (setAutoBatch(false), reload(), void load())} />
                  </div>
                ) : (
                  <div className="space-y-2 text-[13px]">
                    {options.length ? (
                      options.map((o) => (
                        <label key={o.key} className="flex items-start gap-2">
                          <input type="radio" name="decision" checked={option.startsWith(`[${o.key}]`)} onChange={() => setOption(`[${o.key}] ${o.text}`)} className="mt-1" />
                          <span>
                            <b>[{o.key}]</b> {o.text}
                          </span>
                        </label>
                      ))
                    ) : (
                      <input value={option} onChange={(e) => setOption(e.target.value)} placeholder="결정 내용을 직접 적으세요" className="w-full rounded-sm border-2 border-line bg-panel px-2 py-1" />
                    )}
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="메모 (선택)" className="w-full rounded-sm border-2 border-line bg-panel px-2 py-1" />
                    {followUps.length > 0 && (
                      <div>
                        <div className="pixel mb-1 text-[12px] text-muted">후속 업무로 등록할 항목</div>
                        {followUps.map((f, i) => (
                          <label key={i} className="flex items-start gap-2">
                            <input type="checkbox" checked={follow[i] ?? true} onChange={(e) => setFollow({ ...follow, [i]: e.target.checked })} className="mt-1" />
                            <span>
                              <b className="pixel">{EMPLOYEE_BY_ID[f.employeeId]?.name}</b> {f.instruction}
                            </span>
                          </label>
                        ))}
                        <select value={followMode} onChange={(e) => setFollowMode(e.target.value as "batch" | "manual" | "api")} className="mt-1 w-full rounded-sm border-2 border-line bg-panel px-2 py-1 text-[12px]" aria-label="후속 업무 진행 방식">
                          <option value="batch">{typeof sample === "function" ? "후속 업무: ⚡ Claude가 한 번에 실행 + 한결 종합 (추천)" : "후속 업무: 한 번에 실행 (붙여넣기 1번) + 한결 종합 (추천)"}</option>
                          <option value="manual">후속 업무: 하나씩 따로 (붙여넣기)</option>
                          <option value="api" disabled={!apiReady}>
                            후속 업무: API 자동{apiReady ? "" : " (실행기·키 필요)"}
                          </option>
                        </select>
                      </div>
                    )}
                    <button type="button" onClick={decide} disabled={!option.trim()} className="pixel w-full rounded-sm bg-hi py-1.5 font-bold text-void disabled:opacity-40">
                      결정 기록
                    </button>
                  </div>
                )}
                {decideMsg && <p className="mt-2 text-[12px] text-ok">{decideMsg}</p>}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type Decision = { option: string; note: string; followUpTaskIds?: string[]; synthesisReportId?: string };

/** The whole meeting as one Markdown document (for copy / download). */
function minutesMarkdown(d: MeetingData): string {
  const decision = d.meeting.decision ? (JSON.parse(d.meeting.decision) as Decision) : null;
  const when = new Date(d.meeting.endedAt ?? d.meeting.createdAt).toLocaleString("ko-KR");
  const parts = [
    `# 회의록: ${topicTitle(d.meeting.topic)}`,
    `- 일시: ${when}`,
    `- 참석: ${d.participants.map((p) => `${EMPLOYEE_BY_ID[p.employeeId]?.name}(${EMPLOYEE_BY_ID[p.employeeId]?.title})`).join(", ")}`,
    decision ? `- 대표 결정: ${decision.option}${decision.note ? ` — ${decision.note}` : ""}` : "- 대표 결정: 대기",
    "",
    "## 안건",
    d.meeting.topic.trim(),
    "",
    "## 부서별 의견",
    ...d.participants.map((p) => `### ${EMPLOYEE_BY_ID[p.employeeId]?.name} · ${EMPLOYEE_BY_ID[p.employeeId]?.title}\n\n${(p.statement ?? "").trim()}\n`),
    "## CEO Advisor 종합",
    (d.report?.body ?? "").trim(),
  ];
  return parts.join("\n");
}

const showReport = (id: string) => {
  useOffice.getState().openMeeting(null);
  useOffice.getState().openReport(id);
};

/** After the decision: run every follow-up in one go (Claude or one paste), then show the synthesis. */
function FollowUpRun({ d, decision, autoStart, onDone }: { d: MeetingData; decision: Decision; autoStart: boolean; onDone: () => void }) {
  const list = d.followUps ?? [];
  if (!list.length) return null;
  const pending = list.filter((f) => f.status === "QUEUED" && f.executionMode === "manual");
  return (
    <div className="space-y-2 rounded-sm border border-line bg-panel p-2" data-testid="follow-ups">
      <div className="pixel text-[12px] text-muted">후속 업무 {list.length}건</div>
      <ul className="space-y-0.5 text-[12px]">
        {list.map((f) => (
          <li key={f.id} className="flex items-center gap-2">
            <span className={f.status === "COMPLETED" ? "text-ok" : f.status === "QUEUED" ? "text-hi" : "text-muted"}>{f.status === "COMPLETED" ? "✓" : f.status === "QUEUED" ? "…" : "·"}</span>
            <b className="pixel shrink-0">{EMPLOYEE_BY_ID[f.employeeId]?.name}</b>
            <span className="min-w-0 flex-1 truncate">{f.title}</span>
            {f.reportId && (
              <button type="button" onClick={() => showReport(f.reportId!)} className="pixel shrink-0 text-[11px] text-info underline">
                보고서
              </button>
            )}
          </li>
        ))}
      </ul>
      {decision.synthesisReportId && (
        <button
          type="button"
          onClick={() => showReport(decision.synthesisReportId!)}
          className="pixel w-full rounded-sm bg-ok py-1.5 text-[13px] font-bold text-void"
          data-testid="open-synthesis"
        >
          📄 실행 결과 종합 보기 (복사·파일 저장)
        </button>
      )}
      {pending.length > 0 && (
        <ManualRun
          batch={{ taskIds: pending.map((f) => f.id), employeeIds: pending.map((f) => f.employeeId), meetingId: d.meeting.id }}
          autoStart={autoStart}
          onDone={(r) => {
            onDone();
            if (r?.synthesisReportId) showReport(r.synthesisReportId);
          }}
        />
      )}
    </div>
  );
}
