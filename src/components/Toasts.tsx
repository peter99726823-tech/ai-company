"use client";

import { useEffect } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { toGame } from "@/game/bridge";

/** 대표 알림: real completion/failure events from the server. */
export function Toasts() {
  const toasts = useOffice((s) => s.toasts);
  const dismiss = useOffice((s) => s.dismissToast);
  const openReport = useOffice((s) => s.openReport);

  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => dismiss(toasts[0].id), toasts[0].reportId || toasts[0].meetingId ? 30000 : 15000);
    return () => clearTimeout(t);
  }, [toasts, dismiss]);

  return (
    <div className="pointer-events-none absolute bottom-10 left-1/2 z-30 flex w-[min(460px,calc(100%-16px))] -translate-x-1/2 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`px-frame pointer-events-auto flex items-start gap-2 rounded-md bg-panel p-2 text-[13px] ${t.tone === "ok" ? "border-ok/60" : t.tone === "bad" ? "border-bad/60" : ""}`}>
          <span className={`pixel mt-0.5 shrink-0 text-[11px] ${t.tone === "ok" ? "text-ok" : "text-bad"}`}>{t.tone === "ok" ? "완료" : "실패"}</span>
          <div className="min-w-0 flex-1">
            <b className="pixel text-[12px]">{t.employeeId ? EMPLOYEE_BY_ID[t.employeeId]?.name : ""}</b> <span className="text-muted">{t.text}</span>
            <div className="mt-1 flex gap-2">
              {t.meetingId && (
                <button type="button" onClick={() => (useOffice.getState().openMeeting(t.meetingId!), dismiss(t.id))} className="pixel rounded-sm bg-hi px-2 py-0.5 text-[11px] font-bold text-void">
                  회의록 열기
                </button>
              )}
              {t.reportId && (
                <button type="button" onClick={() => (openReport(t.reportId!), dismiss(t.id))} className="pixel rounded-sm bg-hi px-2 py-0.5 text-[11px] font-bold text-void">
                  보고서 열기
                </button>
              )}
              {t.employeeId && (
                <button type="button" onClick={() => (toGame.emit("select", t.employeeId!), dismiss(t.id))} className="pixel rounded-sm border border-line px-2 py-0.5 text-[11px]">
                  직원 보기
                </button>
              )}
            </div>
          </div>
          <button type="button" onClick={() => dismiss(t.id)} className="pixel text-muted hover:text-ink" aria-label="알림 닫기">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
