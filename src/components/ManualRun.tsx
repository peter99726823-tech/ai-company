"use client";

import { useEffect, useState } from "react";

/**
 * Manual (free) execution: copy the prompt → paste into claude.ai → paste the answer back.
 * The server validates the answer; nothing is saved if it doesn't fit.
 */
export function ManualRun({ taskId, onDone, meeting }: { taskId: string; onDone: () => void; meeting?: boolean }) {
  const [prompt, setPrompt] = useState<string>("");
  const [answer, setAnswer] = useState("");
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/prompt`)
      .then((r) => r.json())
      .then((j) => (j.prompt ? setPrompt(j.prompt) : setErr(j.error)))
      .catch((e) => setErr((e as Error).message));
  }, [taskId]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied("ok");
    } catch {
      const el = document.getElementById(`prompt-${taskId}`) as HTMLTextAreaElement | null;
      el?.select();
      setCopied("manual");
    }
  }

  async function submit() {
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/tasks/${taskId}/submit`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: answer }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setErr(j.error ?? "저장하지 못했습니다.");
      return;
    }
    setAnswer("");
    onDone();
  }

  return (
    <div className="space-y-3 text-[13px]" data-testid="manual-run">
      <ol className="space-y-3">
        <li className="rounded-sm border border-line bg-panel-2 p-2">
          <div className="pixel mb-1 text-[12px] text-hi">1. 지시문 복사</div>
          <p className="mb-2 text-[12px] text-muted">
            {meeting ? "참석 부서와 진행 규칙이 모두 들어 있는 회의 지시문입니다." : "직원 역할과 프로젝트 정보가 들어 있는 지시문입니다."} 그대로 복사하세요.
          </p>
          <textarea id={`prompt-${taskId}`} readOnly value={prompt} rows={5} className="w-full resize-y rounded-sm border border-line bg-void p-2 font-mono text-[11px] text-muted" />
          <button type="button" onClick={copy} disabled={!prompt} className="pixel mt-1 rounded-sm bg-hi px-3 py-1 text-[12px] font-bold text-void disabled:opacity-40">
            지시문 복사
          </button>
          {copied === "ok" && <span className="pixel ml-2 text-[11px] text-ok">복사했습니다</span>}
          {copied === "manual" && <span className="pixel ml-2 text-[11px] text-warn">자동 복사가 막혀 전체를 선택했습니다. Ctrl+C로 복사하세요.</span>}
        </li>
        <li className="rounded-sm border border-line bg-panel-2 p-2">
          <div className="pixel mb-1 text-[12px] text-hi">2. claude.ai에 붙여넣기</div>
          <p className="text-[12px] text-muted">
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer" className="text-info underline">
              claude.ai
            </a>
            에서 새 대화를 열고 붙여넣어 보냅니다. 무료 플랜으로도 됩니다. API 비용은 들지 않습니다.
          </p>
        </li>
        <li className="rounded-sm border border-line bg-panel-2 p-2">
          <div className="pixel mb-1 text-[12px] text-hi">3. 답변 전체를 복사해 여기에 붙여넣기</div>
          <textarea
            id={`answer-${taskId}`}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={6}
            placeholder={meeting ? "=== 부서: ... 로 시작하는 답변 전체를 붙여넣으세요" : "답변 전체를 붙여넣으세요"}
            className="w-full resize-y rounded-sm border-2 border-line bg-void p-2 text-[12px]"
          />
          {err && <p className="mt-1 rounded-sm bg-bad/10 p-2 text-[12px] text-bad">{err}</p>}
          <button type="button" onClick={submit} disabled={busy || answer.trim().length < 40} className="pixel mt-1 w-full rounded-sm bg-hi py-1.5 text-[13px] font-bold text-void disabled:opacity-40">
            {busy ? "확인 중…" : meeting ? "회의록 제출" : "보고서 제출"}
          </button>
        </li>
      </ol>
    </div>
  );
}
