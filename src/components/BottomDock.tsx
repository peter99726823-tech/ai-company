"use client";

import { useState } from "react";
import { useOffice } from "@/store/officeStore";
import { toGame } from "@/game/bridge";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import type { OfficeSnapshot } from "@/server/services/office";

const time = (ms: number) => {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
};

export function BottomDock({ data, error }: { data: OfficeSnapshot | null; error: string | null }) {
  const [tab, setTab] = useState<"events" | "movement">("events");
  const movements = useOffice((s) => s.movements);
  const live = useOffice((s) => s.liveEvents);
  const openReport = useOffice((s) => s.openReport);
  // Live SSE events first, then whatever the snapshot has (dedup by id, newest first).
  const events = [...new Map([...live, ...(data?.recentEvents ?? [])].map((e) => [e.id, e])).values()].sort((a, b) => b.id - a.id).slice(0, 80);

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-2 overflow-y-auto border-t-2 border-line bg-panel p-2 lg:grid-cols-[1.6fr_1fr_1fr]">
      <Panel
        title={
          <div className="flex gap-1">
            <Tab on={tab === "events"} onClick={() => setTab("events")}>
              실시간 업무 로그
            </Tab>
            <Tab on={tab === "movement"} onClick={() => setTab("movement")}>
              사무실 움직임
            </Tab>
          </div>
        }
      >
        {error && <p className="mb-1 text-[12px] text-bad">{error}</p>}
        {tab === "events" ? (
          events.length ? (
            <ol className="font-mono text-[12px]" data-testid="event-log">
              {events.map((e) => (
                <li key={e.id} className="grid grid-cols-[4.5rem_4rem_8rem_1fr] gap-2 border-b border-line/60 py-0.5">
                  <span className="text-muted">{time(e.createdAt)}</span>
                  <span>{e.employeeId ? EMPLOYEE_BY_ID[e.employeeId]?.name : "–"}</span>
                  <span className={`truncate ${e.type === "TASK_FAILED" ? "text-bad" : e.type === "TASK_COMPLETED" ? "text-ok" : "text-info"}`} title={e.type}>
                    {e.type}
                  </span>
                  <span className="truncate">{e.message}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>아직 업무 이벤트가 없습니다. 직원을 클릭해 업무를 지시하면 실행 과정이 이곳에 실시간으로 기록됩니다.</Empty>
          )
        ) : movements.length ? (
          <ol className="text-[12px]">
            {movements.map((m, i) => (
              <li key={`${m.at}-${i}`} className="flex gap-2 border-b border-line/60 py-0.5">
                <span className="font-mono text-muted">{time(m.at)}</span>
                <span className="truncate">{m.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>캐릭터 이동 기록입니다. 업무와는 별개인 화면 연출입니다.</Empty>
        )}
      </Panel>

      <Panel title="최근 완료한 업무">
        {data?.recentCompleted.length ? (
          <ul className="space-y-1 text-[12px]">
            {data.recentCompleted.map((t) => (
              <li key={t.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-muted">{EMPLOYEE_BY_ID[t.employeeId]?.name}</span> {t.title}
                </span>
                {t.meetingId ? (
                  <button type="button" onClick={() => useOffice.getState().openMeeting(t.meetingId)} className="pixel shrink-0 rounded-sm bg-panel px-2 text-[11px] text-hi hover:bg-line">
                    회의록
                  </button>
                ) : (
                  t.reportId && (
                    <button type="button" onClick={() => openReport(t.reportId)} className="pixel shrink-0 rounded-sm bg-panel px-2 text-[11px] text-hi hover:bg-line">
                      보고서
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>완료된 업무가 없습니다.</Empty>
        )}
      </Panel>

      <Panel title="오류 · 승인 요청">
        {data?.attention.length ? (
          <ul className="space-y-1 text-[12px]">
            {data.attention.map((t) => (
              <li key={t.id} data-testid={t.status === "WAITING_APPROVAL" ? "proposal" : undefined}>
                <button
                  type="button"
                  onClick={() =>
                    t.status === "QUEUED" && t.executionMode === "manual"
                      ? t.meetingId
                        ? useOffice.getState().openMeeting(t.meetingId)
                        : useOffice.getState().openManual(t.id)
                      : toGame.emit("select", t.employeeId)
                  }
                  className="w-full truncate text-left hover:text-hi"
                  title={t.error ?? ""}
                >
                  <span className={t.status === "FAILED" ? "text-bad" : "text-hi"}>
                    {t.status === "QUEUED" && t.executionMode === "manual" ? "붙여넣기 대기" : TASK_STATUS_LABEL[t.status as TaskStatus]}
                  </span>{" "}
                  <span className="text-muted">{EMPLOYEE_BY_ID[t.employeeId]?.name}</span> {t.title}
                </button>
                {t.error && <div className="truncate pl-2 text-[11px] text-muted">{t.error}</div>}
                {t.status === "WAITING_APPROVAL" && <ProposalButtons id={t.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>처리할 오류나 승인 요청이 없습니다.</Empty>
        )}
      </Panel>
    </div>
  );
}

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-[120px] min-w-0 flex-col rounded-sm border-2 border-line bg-panel-2 lg:min-h-0">
      <div className="pixel border-b-2 border-line px-2 py-1 text-[12px] text-muted">{title}</div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-1">{children}</div>
    </section>
  );
}

function Tab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={`pixel rounded-sm px-2 ${on ? "bg-line text-ink" : "text-muted hover:text-ink"}`}>
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[12px] leading-relaxed text-muted">{children}</p>;
}

function ProposalButtons({ id }: { id: string }) {
  const act = async (what: "approve" | "reject") => {
    await fetch(`/api/tasks/${id}/${what}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ executionMode: "manual" }) });
  };
  return (
    <span className="ml-2 inline-flex gap-1">
      <button type="button" onClick={() => act("approve")} className="pixel rounded-sm bg-hi px-1.5 text-[11px] font-bold text-void">
        승인
      </button>
      <button type="button" onClick={() => act("reject")} className="pixel rounded-sm border border-line px-1.5 text-[11px]">
        거절
      </button>
    </span>
  );
}
