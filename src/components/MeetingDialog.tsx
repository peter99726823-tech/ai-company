"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEES, EMPLOYEE_BY_ID } from "@/domain/employees";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import { AttachmentPicker } from "./AttachmentPicker";
import type { Attachment } from "@/domain/attachments";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";
import { useSample } from "@/lib/claudeSample";
import { ROOMS } from "@/game/map/officeMap";
import type { RoomId } from "@/domain/types";

/** Departments you can call as a group, in office order. */
const DEPT_ICON: Partial<Record<RoomId, string>> = {
  strategy: "🧭",
  research: "🔎",
  dev: "💻",
  salesMarketing: "📣",
  financeLegal: "📑",
  ops: "⚙️",
};
const DEPTS = ROOMS.filter((r) => DEPT_ICON[r.id]).map((r) => ({
  ...r,
  icon: DEPT_ICON[r.id]!,
  members: EMPLOYEES.filter((e) => e.room === r.id).map((e) => e.id),
}));
const order = (ids: string[]) =>
  EMPLOYEES.map((e) => e.id).filter((id) => ids.includes(id));
const PRESETS: { label: string; hint: string; ids: string[] }[] = [
  {
    label: "기본 5명",
    hint: "전략·검증·개발·마케팅·가격",
    ids: ["ceo-advisor", "validator", "cto", "marketing", "pricing"],
  },
  {
    label: "부서장 회의",
    hint: "부서마다 1명씩",
    ids: ["ceo-advisor", "validator", "cto", "marketing", "bookkeeper", "ops"],
  },
  { label: "공모전 자문단", hint: "심사위원(서진)·현업 컨설턴트(은채)·AI 아키텍트(준서·도윤)·해커톤 전략(태오)·사업성(하린)", ids: ["ceo-advisor", "validator", "planner", "ai-engineer", "cto", "ops", "pricing"] },
  { label: "전원 소집", hint: "12명 모두", ids: EMPLOYEES.map((e) => e.id) },
];

const DEFAULT = ["ceo-advisor", "validator", "cto", "marketing", "pricing"];

/** 회의 소집: topic + participants + how to run it. */
export function MeetingDialog({
  data,
  health,
  reload,
}: {
  data: OfficeSnapshot | null;
  health: Health | null;
  reload: () => void;
}) {
  const open = useOffice((s) => s.meetingDialog);
  const setOpen = useOffice((s) => s.setMeetingDialog);
  const openMeeting = useOffice((s) => s.openMeeting);
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [picked, setPicked] = useState<string[]>(DEFAULT);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;
  const [mode, setMode] = useState<"manual" | "api" | "claude">("manual");
  const sample = useSample();
  const [tab, setTab] = useState<"new" | "paste">("new");
  const [pasted, setPasted] = useState("");
  const [retry, setRetry] = useState<{
    meetingId: string;
    taskId: string;
    ids: string;
  } | null>(null);
  // Departments found in a pasted answer, in the order they speak.
  const found = useMemo(() => {
    const ids: string[] = [];
    for (const m of pasted.matchAll(/^===\s*부서:\s*([a-z-]+)/gm))
      if (EMPLOYEE_BY_ID[m[1]] && !ids.includes(m[1])) ids.push(m[1]);
    return ids;
  }, [pasted]);
  const hasSummary = /^===\s*종합/m.test(pasted);
  const claudeReady = typeof sample === "function";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const portraits = useMemo(
    () =>
      typeof document === "undefined"
        ? {}
        : Object.fromEntries(
            EMPLOYEES.map((e) => [e.id, portraitDataUrl(e.look, 3)]),
          ),
    [],
  );

  useEffect(() => {
    if (open) {
      setErr(null);
      setMode(apiReady ? "api" : claudeReady ? "claude" : "manual");
      const draft = useOffice.getState().meetingTopicDraft;
      if (draft) {
        setTopic(draft);
        useOffice.setState({ meetingTopicDraft: "" });
      }
    }
  }, [open, apiReady, claudeReady]);
  if (!open) return null;

  const toggle = (id: string) => {
    if (id === "ceo-advisor") return; // always attends
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };

  /** Call one department: its members plus the CEO Advisor, who always chairs. */
  const onlyDept = (members: string[]) =>
    setPicked(order(["ceo-advisor", ...members]));
  /** Add or remove a whole department from the current selection. */
  const toggleDept = (members: string[]) =>
    setPicked((p) => {
      const all = members.every((id) => p.includes(id));
      const next = all
        ? p.filter((id) => id === "ceo-advisor" || !members.includes(id))
        : [...new Set([...p, ...members])];
      return order(
        next.includes("ceo-advisor") ? next : ["ceo-advisor", ...next],
      );
    });
  const samePick = (ids: string[]) =>
    ids.length === picked.length && ids.every((id) => picked.includes(id));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (tab === "paste") return submitPasted();
    setBusy(true);
    setErr(null);
    const r = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic,
        participantIds: picked,
        projectId: projectId || null,
        executionMode: mode === "api" ? "api" : "manual",
        attachments,
      }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? "회의를 만들지 못했습니다.");
      return;
    }
    setOpen(false);
    setTopic("");
    setAttachments([]);
    reload();
    useOffice.setState({
      autoMeetingId: mode === "claude" ? j.meeting.id : null,
    });
    openMeeting(j.meeting.id);
  }

  /** An answer the CEO already has (e.g. from claude.ai): make the meeting from its departments and save it in one go. */
  async function submitPasted() {
    setBusy(true);
    setErr(null);
    // A failed paste keeps its meeting; fixing the text and retrying reuses it (no duplicate meetings).
    let target = retry && retry.ids === found.join(",") ? retry : null;
    if (!target) {
      const r = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim() || "붙여넣은 회의록",
          participantIds: found,
          projectId: projectId || null,
          executionMode: "manual",
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setBusy(false);
        setErr(j.error ?? "회의를 만들지 못했습니다.");
        return;
      }
      target = {
        meetingId: j.meeting.id,
        taskId: j.task.id,
        ids: found.join(","),
      };
    }
    const sub = await fetch(`/api/tasks/${target.taskId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: pasted }),
    });
    const sj = await sub.json().catch(() => ({}));
    setBusy(false);
    reload();
    if (!sub.ok) {
      setRetry(target);
      setErr(
        `저장하지 못했습니다: ${sj.error ?? "형식 오류"} 답변을 고쳐 다시 누르세요.`,
      );
      return;
    }
    setRetry(null);
    setOpen(false);
    setTopic("");
    setPasted("");
    useOffice.setState({ autoMeetingId: null });
    openMeeting(target.meetingId);
  }

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="회의 소집"
    >
      <form
        ref={formRef}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="px-frame scroll-thin max-h-[92dvh] w-full max-w-2xl space-y-3 overflow-y-auto rounded-md bg-panel p-4 pb-0 text-[13px]"
      >
        <div className="-mx-4 -mt-4 flex items-start justify-between gap-3 border-b-2 border-line bg-[linear-gradient(135deg,rgba(199,146,234,0.18),rgba(255,181,71,0.12)_60%,transparent)] px-4 pt-4 pb-3">
          <div>
            <h2 className="pixel text-[18px] font-bold">📣 회의 소집</h2>
            <p className="mt-0.5 text-[12px] text-muted">
              주제를 정하고, 부서를 골라 부르면 회의실에 모여 부서별 의견과
              종합을 냅니다.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="pixel rounded-sm px-2 text-muted hover:text-ink"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1" role="tablist">
          {(
            [
              ["new", "새 회의 진행"],
              ["paste", "📋 받은 답변 바로 붙여넣기"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => (setTab(k), setErr(null))}
              className={`pixel rounded-sm border-2 py-1.5 text-[12px] ${tab === k ? "border-hi bg-hi font-bold text-void" : "border-line bg-panel-2 text-muted hover:text-ink"}`}
            >
              {l}
            </button>
          ))}
        </div>
        {tab === "paste" && (
          <section className="space-y-1" data-testid="paste-answer">
            <p className="text-[12px] text-muted">
              claude.ai나 이 대화에서 이미 받은 회의 답변(=== 부서: … 와 ===
              종합 … 이 들어 있는 글)을 통째로 붙여넣으세요. 참석 부서는
              답변에서 자동으로 찾습니다.
            </p>
            <textarea
              id="meeting-paste"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="여기에 답변 전체를 붙여넣기 (Ctrl+V)"
              className="block h-[max(220px,36vh)] w-full resize-y rounded-sm border-2 border-hi/60 bg-void p-2 text-[12px] leading-relaxed focus:border-hi focus:outline-none"
            />
            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              <span className="text-muted tabular-nums">
                {pasted.length.toLocaleString()}자 · 찾은 부서 {found.length}개
              </span>
              {found.map((id) => (
                <span
                  key={id}
                  className="pixel rounded-sm border border-ok px-1 text-ok"
                >
                  ✓ {EMPLOYEE_BY_ID[id].name}
                </span>
              ))}
              <span
                className={`pixel rounded-sm border px-1 ${hasSummary ? "border-ok text-ok" : "border-line text-muted"}`}
              >
                {hasSummary ? "✓" : "·"} 종합
              </span>
              {pasted.trim() && !found.includes("ceo-advisor") && (
                <span className="text-warn">
                  한결(ceo-advisor) 발언이 없으면 저장되지 않습니다.
                </span>
              )}
            </div>
          </section>
        )}
        <label className="block">
          <span className="pixel text-[12px] text-muted">
            {tab === "paste"
              ? "회의 주제 (비우면 '붙여넣은 회의록')"
              : "회의 주제"}
          </span>
          <textarea
            id="meeting-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={4}
            placeholder="예: Number Maze를 계속 개발할지, 접고 AI 맞춤형 솔루션 영업에 집중할지"
            className="mt-1 w-full resize-y rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
          />
          <span className={`mt-0.5 block text-right text-[11px] tabular-nums ${topic.length > 20000 ? "text-bad" : "text-muted"}`}>
            {topic.length.toLocaleString()} / 20,000자{topic.length > 20000 ? " · 너무 깁니다. 일부는 📎 파일로 첨부하세요" : ""}
          </span>
        </label>
        {tab === "new" && (
          <AttachmentPicker
            value={attachments}
            onChange={setAttachments}
            dropRef={formRef}
          />
        )}
        <label className="block">
          <span className="pixel text-[12px] text-muted">관련 프로젝트</span>
          <select
            id="meeting-project"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="mt-1 w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
          >
            <option value="">선택 안 함</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {tab === "new" && (
          <>
            <fieldset data-testid="dept-picker">
              <legend className="pixel text-[12px] text-muted">
                참석자 · 부서별로 부르거나 한 명씩 고르세요 (한결은 항상 참석해
                마지막에 종합)
              </legend>
              <div className="mt-1 flex flex-wrap gap-1">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setPicked(order(p.ids))}
                    aria-pressed={samePick(p.ids)}
                    title={p.hint}
                    className={`pixel rounded-full border-2 px-2.5 py-0.5 text-[12px] ${samePick(p.ids) ? "border-hi bg-hi/15 text-hi" : "border-line bg-panel-2 hover:border-hi/60"}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {DEPTS.map((d) => {
                  const n = d.members.filter((id) =>
                    picked.includes(id),
                  ).length;
                  const full = n === d.members.length;
                  return (
                    <section
                      key={d.id}
                      data-dept={d.id}
                      className="overflow-hidden rounded-md border-2 bg-panel-2 transition-colors"
                      style={{
                        borderColor: n ? d.accent : "var(--color-line)",
                        boxShadow: n ? `inset 0 3px 0 ${d.accent}` : undefined,
                      }}
                    >
                      <div className="flex items-center gap-1.5 px-2 pt-1.5">
                        <span className="text-[15px]" aria-hidden>
                          {d.icon}
                        </span>
                        <span
                          className="pixel flex-1 text-[13px] font-bold"
                          style={{ color: n ? d.accent : undefined }}
                        >
                          {d.name}
                        </span>
                        <span className="pixel text-[11px] text-muted tabular-nums">
                          {n}/{d.members.length}
                        </span>
                      </div>
                      <div className="flex gap-1 px-2 pt-1">
                        <button
                          type="button"
                          onClick={() => toggleDept(d.members)}
                          aria-label={`${d.name} ${full ? "빼기" : "전체 부르기"}`}
                          className="pixel rounded-sm border border-line px-1.5 text-[11px] hover:border-hi"
                        >
                          {full ? "－ 부서 빼기" : "＋ 부서 전체"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onlyDept(d.members)}
                          aria-label={`${d.name}만 회의`}
                          className="pixel rounded-sm border border-line px-1.5 text-[11px] hover:border-hi"
                        >
                          이 부서만
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-1 p-2">
                        {d.members.map((id) => {
                          const e = EMPLOYEE_BY_ID[id];
                          const on = picked.includes(id);
                          const fixed = id === "ceo-advisor";
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggle(id)}
                              aria-pressed={on}
                              data-employee={id}
                              title={
                                fixed
                                  ? "CEO Advisor는 항상 참석합니다"
                                  : `${e.name} · ${e.titleKo}`
                              }
                              className={`relative flex flex-col items-center rounded-sm border-2 px-0.5 pt-1 pb-0.5 transition ${on ? "bg-panel" : "border-transparent opacity-45 grayscale hover:opacity-80"}`}
                              style={{
                                borderColor: on ? e.look.accent : undefined,
                              }}
                            >
                              {on && (
                                <span
                                  className="absolute top-0 right-0.5 text-[10px]"
                                  style={{ color: e.look.accent }}
                                >
                                  {fixed ? "★" : "✓"}
                                </span>
                              )}
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={portraits[id]}
                                alt=""
                                width={24}
                                height={36}
                                className="pixelated"
                              />
                              <span className="pixel mt-0.5 text-[12px] leading-none">
                                {e.name}
                              </span>
                              <span className="w-full truncate text-center text-[9px] text-muted">
                                {e.titleKo}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="pixel text-[12px] text-muted">
                진행 방식
              </legend>
              {claudeReady && (
                <label className="flex items-start gap-2 rounded-sm border-2 border-hi/70 p-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "claude"}
                    onChange={() => setMode("claude")}
                    className="mt-1"
                  />
                  <span>
                    <b className="pixel text-[12px]">
                      ⚡ Claude 자동 (추천 · API 키 없이)
                    </b>
                    <span className="block text-[12px] text-muted">
                      회의를 시작하면 Claude가 바로 부서별 의견과 종합을 작성해
                      저장합니다. 로그인한 claude.ai 계정의 사용량을 씁니다.
                    </span>
                  </span>
                </label>
              )}
              <label className="flex items-start gap-2 rounded-sm border border-line p-2">
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "manual"}
                  onChange={() => setMode("manual")}
                  className="mt-1"
                />
                <span>
                  <b className="pixel text-[12px]">📋 복사·붙여넣기 (무료)</b>
                  <span className="block text-[12px] text-muted">
                    회의 지시문을 claude.ai에 붙여넣고, 받은 답을 다시
                    붙여넣습니다. API 비용 0원.
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-2 rounded-sm border border-line p-2 ${apiReady ? "" : "opacity-50"}`}
              >
                <input
                  type="radio"
                  name="mode"
                  checked={mode === "api"}
                  onChange={() => setMode("api")}
                  disabled={!apiReady}
                  className="mt-1"
                />
                <span>
                  <b className="pixel text-[12px]">🔌 API 자동</b>
                  <span className="block text-[12px] text-muted">
                    {apiReady
                      ? `실행기가 ${health?.ai.model}로 바로 진행합니다. 1회 호출, 비용 발생.`
                      : "실행기와 API 키가 있어야 쓸 수 있습니다."}
                  </span>
                </span>
              </label>
            </fieldset>
            <p className="text-[11px] leading-relaxed text-muted">
              부서별 의견은 AI가 한 번의 응답에서 각 부서 역할로 차례대로
              작성합니다. 앞 사람의 발언을 보고 이어서 말합니다. 형식에 맞지
              않는 답은 저장하지 않습니다.
            </p>
          </>
        )}
        {err && (
          <p className="rounded-sm bg-bad/10 p-2 text-[12px] text-bad">{err}</p>
        )}
        <div className="sticky bottom-0 -mx-4 border-t-2 border-line bg-panel/95 px-4 py-3 backdrop-blur">
          {tab === "paste" ? (
            <button
              type="submit"
              disabled={busy || found.length < 2 || !hasSummary}
              className="pixel w-full rounded-sm bg-hi py-2 text-[14px] font-bold text-void disabled:opacity-40"
            >
              {busy ? "저장 중…" : "회의록으로 저장"}
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <div
                className="flex shrink-0 items-end"
                aria-label={`참석 ${picked.length}명`}
                data-testid="picked-summary"
              >
                {picked.slice(0, 8).map((id, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={id}
                    src={portraits[id]}
                    alt={EMPLOYEE_BY_ID[id]?.name}
                    width={16}
                    height={24}
                    className="pixelated -ml-1 first:ml-0 rounded-sm bg-panel-2"
                    style={{ zIndex: 10 - i }}
                  />
                ))}
                <span className="pixel ml-1.5 text-[12px] text-muted tabular-nums">
                  {picked.length}명
                </span>
              </div>
              <button
                type="submit"
                disabled={busy || !topic.trim() || picked.length < 2}
                className="pixel flex-1 rounded-sm bg-hi py-2 text-[14px] font-bold text-void shadow-[0_3px_0_#b3741f] transition active:translate-y-0.5 active:shadow-none disabled:opacity-40"
              >
                {busy
                  ? "소집 중…"
                  : mode === "claude"
                    ? "회의 시작 (Claude가 바로 진행)"
                    : "회의 시작"}
              </button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
}
