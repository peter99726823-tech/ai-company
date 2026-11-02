"use client";

import { useEffect, useMemo, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEES } from "@/domain/employees";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

const DEFAULT = ["ceo-advisor", "validator", "cto", "marketing", "pricing"];

/** 회의 소집: topic + participants + how to run it. */
export function MeetingDialog({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const open = useOffice((s) => s.meetingDialog);
  const setOpen = useOffice((s) => s.setMeetingDialog);
  const openMeeting = useOffice((s) => s.openMeeting);
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState("");
  const [picked, setPicked] = useState<string[]>(DEFAULT);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;
  const [mode, setMode] = useState<"manual" | "api">("manual");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const portraits = useMemo(() => (typeof document === "undefined" ? {} : Object.fromEntries(EMPLOYEES.map((e) => [e.id, portraitDataUrl(e.look, 2)]))), []);

  useEffect(() => {
    if (open) {
      setErr(null);
      setMode(apiReady ? "api" : "manual");
      const draft = useOffice.getState().meetingTopicDraft;
      if (draft) {
        setTopic(draft);
        useOffice.setState({ meetingTopicDraft: "" });
      }
    }
  }, [open, apiReady]);
  if (!open) return null;

  const toggle = (id: string) => {
    if (id === "ceo-advisor") return; // always attends
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, participantIds: picked, projectId: projectId || null, executionMode: mode }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? "회의를 만들지 못했습니다.");
      return;
    }
    setOpen(false);
    setTopic("");
    reload();
    openMeeting(j.meeting.id);
  }

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="회의 소집">
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="px-frame scroll-thin max-h-[92dvh] w-full max-w-xl space-y-3 overflow-y-auto rounded-md bg-panel p-4 text-[13px]">
        <div className="flex items-center justify-between">
          <h2 className="pixel text-[16px] font-bold">회의 소집</h2>
          <button type="button" onClick={() => setOpen(false)} className="pixel text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <label className="block">
          <span className="pixel text-[12px] text-muted">회의 주제</span>
          <textarea
            id="meeting-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="예: Number Maze를 계속 개발할지, 접고 AI 맞춤형 솔루션 영업에 집중할지"
            className="mt-1 w-full resize-y rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
          />
        </label>
        <label className="block">
          <span className="pixel text-[12px] text-muted">관련 프로젝트</span>
          <select id="meeting-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="mt-1 w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5">
            <option value="">선택 안 함</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend className="pixel text-[12px] text-muted">참석 부서 ({picked.length}명 · CEO Advisor는 항상 참석해 마지막에 종합)</legend>
          <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-3">
            {EMPLOYEES.map((e) => {
              const on = picked.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => toggle(e.id)}
                  aria-pressed={on}
                  data-employee={e.id}
                  className={`flex items-center gap-1.5 rounded-sm border-2 p-1 text-left ${on ? "border-hi bg-panel-2" : "border-line opacity-60"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={portraits[e.id]} alt="" width={16} height={24} className="pixelated" />
                  <span className="min-w-0">
                    <span className="pixel block text-[12px]">{e.name}</span>
                    <span className="block truncate text-[10px] text-muted">{e.title}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="space-y-1">
          <legend className="pixel text-[12px] text-muted">진행 방식</legend>
          <label className="flex items-start gap-2 rounded-sm border border-line p-2">
            <input type="radio" name="mode" checked={mode === "manual"} onChange={() => setMode("manual")} className="mt-1" />
            <span>
              <b className="pixel text-[12px]">복사·붙여넣기 (무료)</b>
              <span className="block text-[12px] text-muted">회의 지시문을 claude.ai에 붙여넣고, 받은 답을 다시 붙여넣습니다. API 비용 0원.</span>
            </span>
          </label>
          <label className={`flex items-start gap-2 rounded-sm border border-line p-2 ${apiReady ? "" : "opacity-50"}`}>
            <input type="radio" name="mode" checked={mode === "api"} onChange={() => setMode("api")} disabled={!apiReady} className="mt-1" />
            <span>
              <b className="pixel text-[12px]">API 자동</b>
              <span className="block text-[12px] text-muted">
                {apiReady ? `실행기가 ${health?.ai.model}로 바로 진행합니다. 1회 호출, 비용 발생.` : "실행기와 API 키가 있어야 쓸 수 있습니다."}
              </span>
            </span>
          </label>
        </fieldset>
        <p className="text-[11px] leading-relaxed text-muted">
          부서별 의견은 AI가 한 번의 응답에서 각 부서 역할로 차례대로 작성합니다. 앞 사람의 발언을 보고 이어서 말합니다. 형식에 맞지 않는 답은 저장하지 않습니다.
        </p>
        {err && <p className="rounded-sm bg-bad/10 p-2 text-[12px] text-bad">{err}</p>}
        <button type="submit" disabled={busy || !topic.trim() || picked.length < 2} className="pixel w-full rounded-sm bg-hi py-2 text-[14px] font-bold text-void disabled:opacity-40">
          {busy ? "소집 중…" : "회의 시작"}
        </button>
      </form>
    </div>
  );
}
