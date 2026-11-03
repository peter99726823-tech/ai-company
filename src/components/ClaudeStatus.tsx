"use client";

import { useEffect, useState } from "react";
import { getSample, sampleErrorText, type SampleError } from "@/lib/claudeSample";

type PermState = "granted" | "prompt" | "denied" | "unavailable" | "unknown";
type Perms = { state(name: string): Promise<PermState>; manage(): Promise<void> } | null;

async function getPerms(): Promise<Perms> {
  const c = (window as unknown as { claude?: { use(n: string): Promise<unknown> } }).claude;
  if (!c) return null;
  return ((await c.use("permissions").catch(() => null)) as Perms) ?? null;
}

const STATE_TEXT: Record<PermState, string> = {
  granted: "허용됨",
  prompt: "첫 사용 때 허용 창이 뜸",
  denied: "거절됨 (아래 '권한 설정 열기'에서 다시 켜기)",
  unavailable: "이 화면에서 사용 불가",
  unknown: "확인 불가",
};

/** Settings › Claude 자동 연결: where it stands, a one-click test, and the way back from "denied". */
export function ClaudeStatus() {
  const [inClaude, setInClaude] = useState<boolean | null>(null);
  const [hasSample, setHasSample] = useState<boolean | null>(null);
  const [perm, setPerm] = useState<PermState>("unknown");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setInClaude(!!(window as unknown as { claude?: unknown }).claude);
    setHasSample(!!(await getSample()));
    const p = await getPerms();
    setPerm(p ? await p.state("sample").catch(() => "unknown" as PermState) : "unknown");
  };
  useEffect(() => {
    void refresh();
  }, []);

  async function runTest() {
    const sample = await getSample();
    if (!sample) return;
    setBusy(true);
    setTest(null);
    const t0 = Date.now();
    try {
      const r = await sample("연결 확인입니다. '확인'이라고만 답하세요.", { modelTier: "quick", cache: false });
      setTest({ ok: true, text: `정상 — Claude 응답 "${r.text.trim().slice(0, 20)}" (${((Date.now() - t0) / 1000).toFixed(1)}초)` });
    } catch (e) {
      const se = e as SampleError;
      setTest({ ok: false, text: `${sampleErrorText(se)} [코드: ${se.code}]` });
    }
    setBusy(false);
    void refresh();
  }

  async function openPerms() {
    const p = await getPerms();
    try {
      await p?.manage();
    } catch {
      setTest({ ok: false, text: "권한 창을 열지 못했습니다. 화면 오른쪽 위의 아티팩트 메뉴 › 권한(Permissions)에서 Claude 사용을 켜 주세요." });
    }
    void refresh();
  }

  const row = (label: string, value: string, good: boolean | null) => (
    <div className="flex items-center gap-2 text-[12px]">
      <i className={`inline-block h-2 w-2 shrink-0 rounded-full ${good === null ? "bg-muted" : good ? "bg-ok" : "bg-bad"}`} />
      <span className="w-28 shrink-0 text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <section className="space-y-1.5 rounded-sm border border-line bg-panel-2 p-3" data-testid="claude-status">
      <div className="pixel text-[13px] font-bold">⚡ Claude 자동 연결</div>
      {row("claude.ai 안에서 열림", inClaude === null ? "확인 중" : inClaude ? "예" : "아니요 — 링크를 claude.ai 웹에서 여세요", inClaude)}
      {row("Claude 호출 기능", hasSample === null ? "확인 중" : hasSample ? "있음" : "없음", hasSample)}
      {row("사용 권한", STATE_TEXT[perm], perm === "granted" ? true : perm === "prompt" || perm === "unknown" ? null : false)}
      <div className="flex flex-wrap gap-1 pt-1">
        <button type="button" onClick={runTest} disabled={!hasSample || busy} className="pixel rounded-sm bg-hi px-3 py-1 text-[12px] font-bold text-void disabled:opacity-40">
          {busy ? "확인 중…" : "연결 테스트"}
        </button>
        {inClaude && (
          <button type="button" onClick={openPerms} className="pixel rounded-sm border-2 border-line px-2 py-0.5 text-[12px] hover:border-hi">
            권한 설정 열기
          </button>
        )}
      </div>
      {test && <p className={`rounded-sm p-2 text-[12px] ${test.ok ? "bg-ok/10 text-ok" : "bg-bad/10 text-bad"}`}>{test.text}</p>}
      <p className="text-[11px] text-muted">연결 테스트는 짧은 질문 1번을 보내 claude.ai 계정 사용량을 아주 조금 씁니다.</p>
    </section>
  );
}
