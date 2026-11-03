"use client";

import { useEffect, useState } from "react";
import { useOffice, type GameSpeed } from "@/store/officeStore";
import { toGame } from "@/game/bridge";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health, LiveState } from "@/hooks/useOfficeData";
import { useSample } from "@/lib/claudeSample";

const SPEEDS: GameSpeed[] = [0.5, 1, 2, 4];

export function TopBar({ data, health, live }: { data: OfficeSnapshot | null; health: Health | null; live: LiveState }) {
  const speed = useOffice((s) => s.speed);
  const setSpeed = useOffice((s) => s.setSpeed);
  const [now, setNow] = useState<Date | null>(null);
  const sample = useSample();

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ai = health?.ai;
  const aiState = !health
    ? { label: "확인 중", color: "bg-muted" }
    : health.lite
      ? { label: typeof sample === "function" ? "Claude 자동 · 붙여넣기 (API 키 없음)" : "붙여넣기 모드 (무료)", color: "bg-ok" }
    : !ai?.engineConnected
      ? { label: "실행기 꺼짐", color: "bg-bad" }
      : !ai.keyConfigured
        ? { label: "API 키 없음", color: "bg-bad" }
        : ai.lastError
          ? { label: "마지막 호출 실패", color: "bg-bad" }
          : ai.verified
            ? { label: "연결됨", color: "bg-ok" }
            : { label: "키 설정됨 · 검증 전", color: "bg-warn" };
  const liveLabel = health?.lite ? { t: "자동 저장", c: "bg-ok" } : live === "live" ? { t: "실시간", c: "bg-ok" } : live === "connecting" ? { t: "연결 중", c: "bg-muted" } : { t: "재연결 중", c: "bg-warn" };

  return (
    <header className="border-b-2 border-line bg-panel" data-testid="topbar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2 pb-1">
        <div className="flex min-w-0 shrink-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-sm bg-hi text-[13px] font-bold text-void pixel">AI</span>
          <div className="min-w-0">
            <div className="pixel truncate text-[15px] font-bold leading-tight">{data?.company?.name ?? "…"}</div>
            <div className="pixel whitespace-nowrap text-[11px] leading-tight text-muted tabular-nums" suppressHydrationWarning>
              {now ? now.toLocaleString("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}
            </div>
          </div>
        </div>
        {/* Below md the menu gets its own full-width row; a scroll area never right-aligns (that would hide its start). */}
        <nav className="scroll-thin w-full min-w-0 overflow-x-auto whitespace-nowrap py-0.5 md:w-auto md:flex-1" aria-label="메뉴">
          <div className="flex w-max items-center gap-1 md:ml-auto">
          <button type="button" onClick={() => useOffice.getState().setMeetingDialog(true)} className="pixel shrink-0 rounded-sm bg-hi px-3 py-1 text-[13px] font-bold text-void hover:brightness-110">
            회의 소집
          </button>
          {(
            [
              ["minutes", "📄 회의록"],
              ["ideas", data?.newIdeas ? `아이디어 ${data.newIdeas}` : "아이디어"],
              ["projects", "프로젝트"],
              ["finance", "재무"],
              ["settings", "설정"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" onClick={() => useOffice.getState().setPanel(k)} className="pixel shrink-0 rounded-sm border-2 border-line bg-panel-2 px-2 py-0.5 text-[12px] hover:border-hi">
              {l}
            </button>
          ))}
          </div>
        </nav>
      </div>
      <div className="scroll-thin flex items-center gap-1.5 overflow-x-auto whitespace-nowrap px-3 pb-1.5 text-[11px]">
        <Stat label="실행 중" value={data?.counts.running} tone="text-ok" />
        <Stat label="대기" value={data?.counts.queued} tone="text-info" />
        <Stat label="승인 대기" value={data?.counts.waitingApproval} tone="text-hi" />
        <span className="pixel flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-1.5 py-0.5" title={ai?.message ?? ""}>
          <i className={`inline-block h-2 w-2 rounded-full ${aiState.color}`} />
          AI {aiState.label}
          {ai?.model && !health?.lite && <span className="text-muted">· {ai.model}</span>}
        </span>
        <span className="pixel flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-1.5 py-0.5" title="서버 업무 이벤트 스트림 연결 상태">
          <i className={`inline-block h-2 w-2 rounded-full ${liveLabel.c}`} />
          {liveLabel.t}
        </span>
        {!health?.lite && (
          <span className="pixel shrink-0 rounded-sm border border-line bg-panel-2 px-1.5 py-0.5 tabular-nums" title="오늘 기록된 실제 API 사용량 × 가격표 (추정치, 실제 청구액은 콘솔 확인)">
            오늘 비용 ${data ? data.todayCost.usd.toFixed(2) : "–"}
            <span className="text-muted">
              {" "}
              · {data?.todayCost.calls ?? 0}건{data?.todayCost.isEstimate ? " (추정)" : ""}
            </span>
          </span>
        )}
        {data?.autonomy && (
          <span className="pixel shrink-0 rounded-sm border border-line px-1.5 py-0.5 text-muted" title="운영 모드 (설정에서 변경)">
            {{ manual: "수동", semi: "반자동", auto: "자동" }[data.autonomy.mode]} 모드
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-2" role="group" aria-label="게임 속도">
          <span className="pixel mr-0.5 text-muted">연출 속도</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSpeed(s);
                toGame.emit("speed", s);
              }}
              aria-pressed={speed === s}
              className={`pixel rounded-sm px-1.5 py-0.5 tabular-nums ${speed === s ? "bg-hi font-bold text-void" : "bg-panel-2 text-muted hover:text-ink"}`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone: string }) {
  return (
    <span className="pixel flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-1.5 py-0.5">
      <span className="text-muted">{label}</span>
      <b className={`tabular-nums ${tone}`}>{value ?? "–"}</b>
    </span>
  );
}
