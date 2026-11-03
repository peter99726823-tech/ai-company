"use client";

import { md } from "@/lib/markdown";
import { ExportButtons } from "./ExportButtons";
import { useEffect, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import type { ReportRow, TaskRow } from "@/server/db/schema";
import { ReportActions } from "./ReportActions";
import { parseAttachments } from "@/domain/attachments";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

interface Decision {
  id: string;
  decision: string | null;
  note: string | null;
  decidedAt: number | null;
}

/** Shows a saved report. The body is AI-written markdown, so it is sanitized before rendering. */
export function ReportModal({ data: office, health, reload }: { data?: OfficeSnapshot | null; health?: Health | null; reload?: () => void }) {
  const id = useOffice((s) => s.reportId);
  const close = () => useOffice.getState().openReport(null);
  const [data, setData] = useState<{ report: ReportRow; task: TaskRow | null; decisions: Decision[]; followUps: TaskRow[] } | null>(null);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setErr(null);
    if (!id) return setData(null);
    fetch(`/api/reports/${id}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setData(j);
      })
      .catch((e) => setErr((e as Error).message));
  }, [id, tick]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  if (!id) return null;
  const emp = data ? EMPLOYEE_BY_ID[data.report.employeeId] : null;
  const sources = data?.report.sources ? (JSON.parse(data.report.sources) as { title: string; url: string }[]) : [];
  const html = data ? md(data.report.body) : "";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={close} role="dialog" aria-modal="true" aria-label="결과 보고서">
      <div className="px-frame flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-md bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 border-b-2 border-line p-3">
          <div className="min-w-0 flex-1">
            <div className="pixel text-[11px] text-muted">결과 보고서 {emp ? `· ${emp.name} (${emp.title})` : ""}</div>
            <h2 className="pixel mt-0.5 text-[16px] font-bold leading-snug">{data?.report.title ?? "불러오는 중…"}</h2>
            {data && (
              <div className="mt-1 text-[12px] text-muted">
                {new Date(data.report.createdAt).toLocaleString("ko-KR")} · 업무 ID {data.task?.id}
              </div>
            )}
            {data && (
              <div className="mt-1.5">
                <ExportButtons title={data.report.title} markdown={() => `# ${data.report.title}\n\n- 작성: ${emp?.name ?? ""} (${emp?.title ?? ""})\n- 작성일: ${new Date(data.report.createdAt).toLocaleString("ko-KR")}\n\n${data.report.body}`} />
              </div>
            )}
          </div>
          <button type="button" onClick={close} className="pixel rounded-sm px-2 text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
          {err && <p className="text-bad">{err}</p>}
          {data?.task && (
            <details className="mb-3 rounded-sm border border-line bg-panel-2 p-2 text-[12px]">
              <summary className="pixel cursor-pointer text-muted">대표의 원래 지시</summary>
              <p className="mt-1 whitespace-pre-wrap">{data.task.instruction}</p>
              {parseAttachments(data.task.attachments).length > 0 && (
                <p className="mt-1 text-muted">첨부: {parseAttachments(data.task.attachments).map((x) => `${x.name} (${x.chars.toLocaleString()}자${x.truncated ? ", 일부만 사용" : ""})`).join(", ")}</p>
              )}
            </details>
          )}
          <article className="report text-[14px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />
          {data && (
            <ReportActions
              key={data.report.id}
              reportId={data.report.id}
              employeeId={data.report.employeeId}
              projectId={data.report.projectId}
              nextTasks={(() => {
                try {
                  return (JSON.parse(data.report.nextTasks ?? "[]") as (string | { instruction: string })[]).map((x) => (typeof x === "string" ? x : x.instruction));
                } catch {
                  return [];
                }
              })()}
              decisions={data.decisions ?? []}
              followUps={data.followUps ?? []}
              projects={office?.projects ?? []}
              apiReady={!!health?.worker.running && !!health?.ai.keyConfigured}
              onDone={() => {
                setTick((t) => t + 1);
                reload?.();
              }}
            />
          )}
          {data && (
            <div className="mt-4 rounded-sm border border-line p-2 text-[12px] text-muted">
              실제 웹 검색 출처:{" "}
              {sources.length
                ? sources.map((s, i) => (
                    <a key={i} href={s.url} target="_blank" rel="noreferrer" className="mr-2 text-info underline">
                      {s.title || s.url}
                    </a>
                  ))
                : "없음 (이 업무에서는 웹 검색을 사용하지 않았습니다)"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
