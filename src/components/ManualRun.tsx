"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { useOffice } from "@/store/officeStore";
import { useSample, sampleErrorText, promptBytes, MAX_PROMPT_BYTES, type SampleError } from "@/lib/claudeSample";

/**
 * Running a task without an API key.
 * - "Claude 자동" (link version inside claude.ai): the page asks Claude on the viewer's own account,
 *   streams the answer into the box and submits it.
 * - Copy/paste: copy the prompt → claude.ai → paste the answer into the big box.
 * Either way the server validates the answer; nothing is saved if it doesn't fit.
 */
export interface BatchJob {
  taskIds: string[];
  /** employee id per task, in order (for the live check). */
  employeeIds: string[];
  meetingId?: string | null;
}

export function ManualRun({
  taskId,
  batch,
  onDone,
  meeting,
  submitLabel,
  autoStart,
}: {
  /** One task… */
  taskId?: string;
  /** …or several follow-up tasks done in one answer. */
  batch?: BatchJob;
  onDone: (result?: { synthesisReportId?: string }) => void;
  meeting?: boolean;
  submitLabel?: string;
  autoStart?: boolean;
}) {
  const key = taskId ?? `batch-${batch?.taskIds.join("-")}`;
  const [prompt, setPrompt] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const [running, setRunning] = useState<{ since: number; ctl: AbortController } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);
  const sample = useSample();
  const minLen = submitLabel ? 1 : 40;

  const batchKey = batch?.taskIds.join(",");
  useEffect(() => {
    const req = batch
      ? fetch("/api/batch/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIds: batch.taskIds }) })
      : fetch(`/api/tasks/${taskId}/prompt`);
    req
      .then((r) => r.json())
      .then((j) => (j.prompt ? setPrompt(j.prompt) : setErr(j.error)))
      .catch((e) => setErr((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, batchKey]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - running.since) / 1000)), 1000);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => () => running?.ctl.abort(), [running]);

  // Meeting answers: show which departments the pasted text already contains.
  const participants = useMemo(() => (/PARTICIPANTS: ([a-z,-]+)/.exec(prompt)?.[1] ?? "").split(",").filter(Boolean), [prompt]);
  const check = useMemo(() => {
    if (batch) {
      const found = batch.taskIds.map((id, i) => ({ id: batch.employeeIds[i], ok: new RegExp(`^===\\s*업무:\\s*${id}\\b`, "m").test(answer) }));
      return { found, summary: /^===\s*종합/m.test(answer), complete: found.every((f) => f.ok) && /^===\s*종합/m.test(answer) };
    }
    if (!meeting || !participants.length) return null;
    const found = participants.map((id) => ({ id, ok: new RegExp(`^===\\s*부서:\\s*${id}\\b`, "m").test(answer) }));
    return { found, summary: /^===\s*종합/m.test(answer), complete: found.every((f) => f.ok) && /^===\s*종합/m.test(answer) };
  }, [meeting, participants, answer, batch]);

  const tooBig = !!prompt && promptBytes(prompt) > MAX_PROMPT_BYTES;
  const canAuto = typeof sample === "function" && !!prompt && !tooBig;

  async function submitText(text: string, via: "manual" | "claude" = "manual") {
    setBusy(true);
    setErr(null);
    const r = batch
      ? await fetch("/api/batch/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskIds: batch.taskIds, meetingId: batch.meetingId ?? null, text, via }) })
      : await fetch(`/api/tasks/${taskId}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, via }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? "저장하지 못했습니다.");
      return false;
    }
    setAnswer("");
    onDone(j);
    return true;
  }

  async function runAuto() {
    if (typeof sample !== "function" || !prompt || running) return;
    const ctl = new AbortController();
    setAutoErr(null);
    setErr(null);
    setAnswer("");
    setElapsed(0);
    setRunning({ since: Date.now(), ctl });
    try {
      const res = await sample(prompt, { onText: ({ text }) => setAnswer(text), signal: ctl.signal, modelTier: "default", cache: false });
      setRunning(null);
      setAnswer(res.text);
      if (res.truncated) setAutoErr("답이 길이 한도에서 끊겼습니다. 저장을 시도합니다. 실패하면 다시 누르세요.");
      await submitText(res.text, "claude");
    } catch (e) {
      setRunning(null);
      const se = e as SampleError;
      if (se.text) setAnswer(se.text);
      if (se.code !== "cancelled") {
        setAutoErr(sampleErrorText(se));
        const logId = taskId ?? batch?.taskIds[0];
        if (logId)
          void fetch(`/api/tasks/${logId}/note`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `Claude 자동 실패: ${se.code}` }) }).catch(() => {});
      }
    }
  }

  // Started from "회의 시작" with Claude 자동 chosen: that click is the viewer's explicit action.
  useEffect(() => {
    if (autoStart && canAuto && !started.current) {
      started.current = true;
      void runAuto();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, canAuto]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("ok");
    } catch {
      const el = document.getElementById(`prompt-${key}`) as HTMLTextAreaElement | null;
      if (el) {
        (el.closest("details") as HTMLDetailsElement | null)?.setAttribute("open", "");
        el.select();
      }
      setCopied("manual");
    }
  }

  async function pasteFromClipboard() {
    setPasteNote(null);
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) {
        setPasteNote("클립보드가 비어 있습니다. claude.ai 답변 아래의 복사 버튼을 먼저 누르세요.");
        return;
      }
      setAnswer(t);
    } catch {
      setPasteNote("브라우저가 클립보드 읽기를 막았습니다. 아래 칸을 누르고 Ctrl+V(맥은 ⌘V)로 붙여넣으세요.");
      answerRef.current?.focus();
    }
  }

  const label = submitLabel ?? (batch ? "결과 한 번에 저장" : meeting ? "회의록 제출" : "보고서 제출");

  return (
    <div className="space-y-3 text-[13px]" data-testid="manual-run">
      {typeof sample === "function" && (
        <section className="rounded-sm border-2 border-hi bg-hi/10 p-3" data-testid="auto-run">
          <div className="pixel text-[13px] font-bold text-hi">⚡ Claude 자동 진행 (API 키 없이)</div>
          <p className="mt-1 text-[12px] text-muted">
            {batch ? `후속 업무 ${batch.taskIds.length}건을 담당 직원별로 한 번에 처리하고, 한결이 결과를 종합합니다.` : meeting ? "부서별 의견과 종합을 Claude가 바로 작성하고 저장합니다." : "Claude가 바로 답을 작성하고 저장합니다."} 지금 로그인한 claude.ai 계정의 사용량을 씁니다(API 비용 없음). 처음 한 번은 허용 창이 뜹니다.
          </p>
          {running ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="pixel flex-1 text-[12px] text-info">
                {answer ? `작성 중… ${answer.length.toLocaleString()}자` : "생각 중…"} ({elapsed}초 · 보통 1~3분, 창을 닫으면 중지)
              </span>
              <button type="button" onClick={() => running.ctl.abort()} className="pixel rounded-sm border-2 border-line px-3 py-1 text-[12px] hover:border-bad">
                중지
              </button>
            </div>
          ) : (
            <button type="button" onClick={runAuto} disabled={!canAuto || busy} className="pixel mt-2 w-full rounded-sm bg-hi py-2 text-[14px] font-bold text-void disabled:opacity-40">
              {busy ? "저장 중…" : answer && autoErr ? "다시 맡기기" : batch ? `Claude에게 ${batch.taskIds.length}건 한 번에 맡기기` : meeting ? "Claude에게 회의 맡기기" : "Claude에게 맡기기"}
            </button>
          )}
          {tooBig && <p className="mt-1 text-[12px] text-warn">지시문이 자동 진행 한도(256KB)를 넘습니다. 첨부를 줄이거나 아래 붙여넣기 방식을 쓰세요.</p>}
          {autoErr && (
            <p className="mt-1 rounded-sm bg-bad/10 p-2 text-[12px] text-bad">
              {autoErr}{" "}
              <button type="button" className="underline" onClick={() => useOffice.getState().setPanel("settings")}>
                연결 확인하기
              </button>
            </p>
          )}
          <p className="mt-2 text-[11px] text-muted">또는 아래처럼 직접 복사·붙여넣기 할 수 있습니다.</p>
        </section>
      )}

      {sample === false && (
        <p className="rounded-sm border border-line bg-panel-2 p-2 text-[11px] text-muted" data-testid="auto-unavailable">
          이 화면에서는 Claude 자동 진행을 쓸 수 없습니다(claude.ai 밖에서 열었거나 앱이 지원하지 않음). 아래 ①~③ 순서로 진행하거나, 다른 곳에서 받은 답이 있으면 ③ 칸에 바로 붙여넣으세요.
        </p>
      )}
      <section className="rounded-sm border border-line bg-panel-2 p-2">
        <div className="pixel mb-1 text-[12px] text-hi">① 지시문 복사 → ② claude.ai에 붙여넣어 보내기</div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={copy} disabled={!prompt} className="pixel rounded-sm bg-hi px-3 py-1.5 text-[13px] font-bold text-void disabled:opacity-40">
            지시문 복사
          </button>
          <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="pixel rounded-sm border-2 border-line px-3 py-1 text-[13px] hover:border-hi">
            claude.ai 열기 ↗
          </a>
          {copied === "ok" && <span className="pixel text-[12px] text-ok">복사했습니다. claude.ai 새 대화에 붙여넣어 보내세요.</span>}
          {copied === "manual" && <span className="pixel text-[12px] text-warn">자동 복사가 막혀 전체를 선택했습니다. Ctrl+C로 복사하세요.</span>}
        </div>
        <details className="mt-1">
          <summary className="cursor-pointer text-[11px] text-muted">
            지시문 내용 보기 ({prompt.length.toLocaleString()}자 · {meeting ? "참석 부서와 진행 규칙 포함" : "직원 역할과 프로젝트 정보 포함"})
          </summary>
          <textarea id={`prompt-${key}`} readOnly value={prompt} rows={5} className="mt-1 w-full resize-y rounded-sm border border-line bg-void p-2 font-mono text-[11px] text-muted" />
        </details>
      </section>

      <section className="rounded-sm border-2 border-hi/60 bg-panel-2 p-2" data-testid="answer-box">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <div className="pixel flex-1 text-[13px] font-bold text-hi">③ 받은 답변 붙여넣기</div>
          <button type="button" onClick={pasteFromClipboard} className="pixel rounded-sm border-2 border-line px-2 py-0.5 text-[12px] hover:border-hi">
            📋 클립보드에서 붙여넣기
          </button>
        </div>
        <p className="mb-1 text-[11px] text-muted">claude.ai 답변 맨 아래의 복사 버튼을 누른 뒤, 위 버튼을 누르거나 아래 칸에 Ctrl+V 하세요.</p>
        {pasteNote && <p className="mb-1 text-[12px] text-warn">{pasteNote}</p>}
        <textarea
          ref={answerRef}
          id={`answer-${key}`}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          readOnly={!!running}
          placeholder={meeting ? "여기에 붙여넣기 (=== 부서: ... 로 시작하는 답변 전체)" : "여기에 답변 전체를 붙여넣기"}
          className="block h-[max(220px,38vh)] w-full resize-y rounded-sm border-2 border-line bg-void p-2 text-[12px] leading-relaxed focus:border-hi focus:outline-none"
        />
        <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="text-muted tabular-nums">{answer.length.toLocaleString()}자</span>
          {check &&
            check.found.map((f) => (
              <span key={f.id} className={`pixel rounded-sm border px-1 ${f.ok ? "border-ok text-ok" : "border-line text-muted"}`} title={f.ok ? "발언 있음" : "아직 없음"}>
                {f.ok ? "✓" : "·"} {EMPLOYEE_BY_ID[f.id]?.name ?? f.id}
              </span>
            ))}
          {check && <span className={`pixel rounded-sm border px-1 ${check.summary ? "border-ok text-ok" : "border-line text-muted"}`}>{check.summary ? "✓" : "·"} 종합</span>}
          {check && answer.trim() && !check.complete && !running && <span className="text-warn">빠진 부서가 있으면 저장되지 않습니다. 답변 전체를 복사했는지 확인하세요.</span>}
        </div>
        {err && <p className="mt-1 rounded-sm bg-bad/10 p-2 text-[12px] text-bad">{err}</p>}
        <button
          type="button"
          onClick={() => void submitText(answer)}
          disabled={busy || !!running || answer.trim().length < minLen}
          className="pixel mt-2 w-full rounded-sm bg-hi py-2 text-[14px] font-bold text-void disabled:opacity-40"
        >
          {busy ? "확인 중…" : label}
        </button>
      </section>
    </div>
  );
}
