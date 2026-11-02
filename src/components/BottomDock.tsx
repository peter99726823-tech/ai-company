"use client";

import { useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import type { OfficeSnapshot } from "@/server/services/office";

const time = (ms: number) => new Date(ms).toLocaleTimeString("ko-KR", { hour12: false });

export function BottomDock({ data, error }: { data: OfficeSnapshot | null; error: string | null }) {
  const [tab, setTab] = useState<"events" | "movement">("events");
  const movements = useOffice((s) => s.movements);

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
          data?.recentEvents.length ? (
            <ol className="font-mono text-[12px]">
              {data.recentEvents.map((e) => (
                <li key={e.id} className="grid grid-cols-[4.5rem_4rem_8rem_1fr] gap-2 border-b border-line/60 py-0.5">
                  <span className="text-muted">{time(e.createdAt)}</span>
                  <span>{e.employeeId ? EMPLOYEE_BY_ID[e.employeeId]?.name : "–"}</span>
                  <span className="text-info">{e.type}</span>
                  <span className="truncate">{e.message}</span>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>아직 업무 이벤트가 없습니다. 실제 업무 실행은 PHASE 2에서 연결되며, 그 전에는 이곳에 아무것도 지어내 표시하지 않습니다.</Empty>
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
              <li key={t.id} className="truncate">
                <span className="text-muted">{EMPLOYEE_BY_ID[t.employeeId]?.name}</span> {t.title}
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
              <li key={t.id} className="truncate">
                <span className={t.status === "FAILED" ? "text-bad" : "text-hi"}>{TASK_STATUS_LABEL[t.status as TaskStatus]}</span> {t.title}
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
