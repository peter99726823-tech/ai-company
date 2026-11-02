"use client";

import { useEffect, useState } from "react";
import { useOffice, type GameSpeed } from "@/store/officeStore";
import { toGame } from "@/game/bridge";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health, LiveState } from "@/hooks/useOfficeData";

const SPEEDS: GameSpeed[] = [0.5, 1, 2, 4];

export function TopBar({ data, health, live }: { data: OfficeSnapshot | null; health: Health | null; live: LiveState }) {
  const speed = useOffice((s) => s.speed);
  const setSpeed = useOffice((s) => s.setSpeed);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const ai = health?.ai;
  const aiState = !health
    ? { label: "확인 중", color: "bg-muted" }
    : !ai?.engineConnected
      ? { label: "실행기 꺼짐", color: "bg-bad" }
      : !ai.keyConfigured
        ? { label: "API 키 없음", color: "bg-bad" }
        : ai.lastError
          ? { label: "마지막 호출 실패", color: "bg-bad" }
          : ai.verified
            ? { label: "연결됨", color: "bg-ok" }
            : { label: "키 설정됨 · 검증 전", color: "bg-warn" };
  const liveLabel = live === "live" ? { t: "실시간", c: "bg-ok" } : live === "connecting" ? { t: "연결 중", c: "bg-muted" } : { t: "재연결 중", c: "bg-warn" };

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-line bg-panel px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-sm bg-hi text-[13px] font-bold text-void pixel">AI</span>
        <div className="min-w-0">
          <div className="pixel truncate text-[15px] font-bold leading-tight">{data?.company?.name ?? "…"}</div>
          <div className="pixel text-[11px] leading-tight text-muted tabular-nums" suppressHydrationWarning>
            {now ? now.toLocaleString("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}
          </div>
        </div>
      </div>

      <div className="scroll-thin order-3 flex w-full items-center gap-2 overflow-x-auto text-[12px] whitespace-nowrap sm:order-none sm:w-auto sm:flex-1 sm:flex-wrap">
        <Stat label="실행 중" value={data?.counts.running} tone="text-ok" />
        <Stat label="대기" value={data?.counts.queued} tone="text-info" />
        <Stat label="승인 대기" value={data?.counts.waitingApproval} tone="text-hi" />
        <span className="pixel flex items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-2 py-1" title={ai?.message ?? ""}>
          <i className={`inline-block h-2 w-2 rounded-full ${aiState.color}`} />
          AI {aiState.label}
          {ai?.model && <span className="text-muted">· {ai.model}</span>}
        </span>
        <span className="pixel flex items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-2 py-1" title="서버 업무 이벤트 스트림 연결 상태">
          <i className={`inline-block h-2 w-2 rounded-full ${liveLabel.c}`} />
          {liveLabel.t}
        </span>
        <span className="pixel rounded-sm border border-line bg-panel-2 px-2 py-1 tabular-nums" title="오늘 기록된 실제 API 사용량 × 가격표 (추정치, 실제 청구액은 콘솔 확인)">
          오늘 비용 ${data ? data.todayCost.usd.toFixed(2) : "–"}
          <span className="text-muted">
            {" "}
            · {data?.todayCost.calls ?? 0}건{data?.todayCost.isEstimate ? " (추정)" : ""}
          </span>
        </span>
      </div>

      <button type="button" onClick={() => useOffice.getState().setMeetingDialog(true)} className="pixel rounded-sm bg-hi px-3 py-1 text-[13px] font-bold text-void hover:brightness-110">
        회의 소집
      </button>
      <div className="flex items-center gap-1" role="group" aria-label="게임 속도">
        <span className="pixel mr-1 hidden text-[11px] text-muted sm:inline">연출 속도</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setSpeed(s);
              toGame.emit("speed", s);
            }}
            aria-pressed={speed === s}
            className={`pixel rounded-sm px-2 py-1 text-[12px] tabular-nums ${speed === s ? "bg-hi font-bold text-void" : "bg-panel-2 text-muted hover:text-ink"}`}
          >
            {s}x
          </button>
        ))}
      </div>
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | undefined; tone: string }) {
  return (
    <span className="pixel flex items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-2 py-1">
      <span className="text-muted">{label}</span>
      <b className={`tabular-nums ${tone}`}>{value ?? "–"}</b>
    </span>
  );
}
