"use client";

import { md } from "@/lib/markdown";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { Modal, inputCls } from "./Modal";

interface Minute {
  id: string;
  topic: string;
  createdAt: number;
  endedAt: number | null;
  participants: string[];
  summary: string;
  followUps: number;
  decision: { option: string; note?: string; synthesisReportId?: string } | null;
}


/** First line of a (possibly long, Markdown) topic. */
export const topicTitle = (topic: string) => {
  const first = (topic.trim().split("\n").find((l) => l.trim()) ?? "").split(/\s#{2,}\s/)[0];
  return first.replace(/^#+\s*/, "").replace(/^\[회의 안건\]\s*/, "").trim() || topic.slice(0, 80);
};

/** One section of the CEO Advisor synthesis, e.g. "회의 요약". */
function section(body: string, name: string) {
  return new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m").exec(body)?.[1]?.trim() ?? "";
}

const when = (t: number | null) => (t ? new Date(t).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** 회의록: every finished meeting in one place — summary, decision and options at a glance. */
export function MinutesModal() {
  const open = useOffice((s) => s.panel === "minutes");
  const close = () => useOffice.getState().setPanel(null);
  const lastEvent = useOffice((s) => s.liveEvents[0]?.id);
  const [list, setList] = useState<Minute[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pending" | "decided">("all");
  const [sel, setSel] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/meetings/minutes");
    const j = await r.json().catch(() => ({}));
    setList(j.minutes ?? []);
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load, lastEvent]);

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    return (list ?? []).filter(
      (m) =>
        (filter === "all" || (filter === "pending" ? !m.decision : !!m.decision)) &&
        (!k || m.topic.toLowerCase().includes(k) || m.summary.toLowerCase().includes(k)),
    );
  }, [list, q, filter]);
  const cur = shown.find((m) => m.id === sel) ?? shown[0] ?? null;
  const pending = (list ?? []).filter((m) => !m.decision).length;

  if (!open) return null;
  return (
    <Modal label="회의록" onClose={close} wide>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="주제·내용 검색" className={`${inputCls} max-w-xs flex-1`} aria-label="회의록 검색" />
        {(
          [
            ["all", `전체 ${list?.length ?? 0}`],
            ["pending", `결정 대기 ${pending}`],
            ["decided", "결정 완료"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
            className={`pixel rounded-sm border-2 px-2 py-0.5 text-[12px] ${filter === k ? "border-hi bg-hi font-bold text-void" : "border-line bg-panel-2 hover:border-hi"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {list === null ? (
        <p className="text-muted">불러오는 중…</p>
      ) : !shown.length ? (
        <p className="text-muted">{list.length ? "조건에 맞는 회의록이 없습니다." : "아직 완료된 회의가 없습니다. 상단의 회의 소집으로 회의를 열어 보세요."}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <ul className="scroll-thin space-y-1.5 md:max-h-[64dvh] md:overflow-y-auto md:pr-1" data-testid="minutes-list">
            {shown.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setSel(m.id)}
                  aria-pressed={cur?.id === m.id}
                  className={`w-full rounded-sm border-2 p-2 text-left ${cur?.id === m.id ? "border-hi bg-panel-2" : "border-line hover:border-hi/60"}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="pixel min-w-0 flex-1 truncate text-[13px] font-bold">{topicTitle(m.topic)}</span>
                    <span className={`pixel shrink-0 rounded-sm px-1 text-[10px] ${m.decision ? "bg-ok/20 text-ok" : "bg-hi/20 text-hi"}`}>{m.decision ? "결정 완료" : "결정 대기"}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted">
                    {when(m.endedAt)} · {m.participants.length}명
                  </div>
                  {m.decision && <div className="mt-0.5 truncate text-[11px] text-ok">→ {m.decision.option}</div>}
                </button>
              </li>
            ))}
          </ul>

          {cur && (
            <article className="space-y-2 rounded-sm border border-line bg-panel-2 p-3" data-testid="minutes-detail">
              <h3 className="pixel text-[15px] font-bold leading-snug">{topicTitle(cur.topic)}</h3>
              <div className="flex flex-wrap gap-1">
                {cur.participants.map((id) => (
                  <span key={id} className="pixel rounded-sm border border-line px-1.5 text-[11px]" style={{ color: EMPLOYEE_BY_ID[id]?.look.accent }}>
                    {EMPLOYEE_BY_ID[id]?.name ?? id}
                  </span>
                ))}
              </div>
              <div className={`rounded-sm p-2 text-[13px] ${cur.decision ? "bg-ok/10" : "bg-hi/10"}`}>
                <b className="pixel">{cur.decision ? "대표 결정" : "결정 대기"}</b>
                {cur.decision ? (
                  <p>
                    {cur.decision.option}
                    {cur.decision.note ? ` — ${cur.decision.note}` : ""}
                  </p>
                ) : (
                  <p className="text-muted">회의록 열기에서 선택지를 골라 결정을 기록하세요.</p>
                )}
              </div>
              {(["회의 요약", "대표 결정 선택지", "대안 비교"] as const).map((name) => {
                const body = section(cur.summary, name);
                return body ? (
                  <section key={name}>
                    <div className="pixel text-[12px] text-hi">{name}</div>
                    <div className="report text-[13px]" dangerouslySetInnerHTML={{ __html: md(body) }} />
                  </section>
                ) : null;
              })}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => (close(), useOffice.getState().openMeeting(cur.id))}
                  className="pixel rounded-sm bg-hi px-3 py-1.5 text-[13px] font-bold text-void"
                >
                  회의록 열기 (부서별 발언 · 결정)
                </button>
                {cur.decision?.synthesisReportId && (
                  <button
                    type="button"
                    onClick={() => (close(), useOffice.getState().openReport(cur.decision!.synthesisReportId!))}
                    className="pixel rounded-sm bg-ok px-3 py-1.5 text-[13px] font-bold text-void"
                  >
                    📄 실행 결과 종합
                  </button>
                )}
                {cur.followUps > 0 && <span className="text-[11px] text-muted">후속 업무 제안 {cur.followUps}건</span>}
              </div>
            </article>
          )}
        </div>
      )}
    </Modal>
  );
}
