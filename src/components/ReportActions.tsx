"use client";

import { useState } from "react";
import { EMPLOYEES, EMPLOYEE_BY_ID } from "@/domain/employees";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import type { OfficeSnapshot } from "@/server/services/office";

const LABEL: Record<string, string> = {
  APPROVED: "승인",
  REVISION: "수정 요청",
  MORE_ANALYSIS: "추가 분석",
  FORWARD: "다른 직원에게 전달",
  APPLY_TO_PROJECT: "프로젝트에 반영",
  CLOSE: "업무 종료",
};

interface Props {
  reportId: string;
  employeeId: string;
  projectId: string | null;
  nextTasks: string[];
  decisions: { id: string; decision: string | null; note: string | null; decidedAt: number | null }[];
  followUps: { id: string; title: string; employeeId: string; status: string }[];
  projects: OfficeSnapshot["projects"];
  apiReady: boolean;
  onDone: () => void;
}

/** 대표 결재: approve / revise / analyse more / forward / apply to project / close. */
export function ReportActions(p: Props) {
  const [action, setAction] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [projectId, setProjectId] = useState(p.projectId ?? "");
  const proj = p.projects.find((x) => x.id === projectId);
  const [stage, setStage] = useState("");
  const [nextPlan, setNextPlan] = useState("");
  const [mode, setMode] = useState<"manual" | "api">(p.apiReady ? "api" : "manual");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const choose = (a: string) => {
    setAction(a);
    setMsg(null);
    if (a === "APPLY_TO_PROJECT") {
      setStage(proj?.stage ?? "");
      setNextPlan(p.nextTasks[0] ?? proj?.nextPlan ?? "");
    }
  };

  async function submit() {
    const r = await fetch(`/api/reports/${p.reportId}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note, targetEmployeeId: target, executionMode: mode, project: action === "APPLY_TO_PROJECT" ? { id: projectId, stage, nextPlan } : undefined }),
    });
    const j = await r.json();
    if (!r.ok) return setMsg({ ok: false, text: j.error });
    setMsg({ ok: true, text: `${LABEL[action!]} 기록했습니다.${j.createdTaskId ? " 후속 업무를 등록했습니다." : ""}` });
    setAction(null);
    setNote("");
    p.onDone();
  }

  const needsNote = action === "REVISION" || action === "MORE_ANALYSIS";
  const makesTask = action === "REVISION" || action === "MORE_ANALYSIS" || action === "FORWARD";

  return (
    <section className="mt-4 rounded-sm border-2 border-line bg-panel-2 p-3 text-[13px]" data-testid="report-actions">
      <div className="pixel mb-2 text-[13px]">대표 결재</div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(LABEL).map(([k, v]) => (
          <button key={k} type="button" onClick={() => choose(k)} aria-pressed={action === k} className={`pixel rounded-sm border-2 px-2 py-1 text-[12px] ${action === k ? "border-hi text-hi" : "border-line hover:border-hi"}`}>
            {v}
          </button>
        ))}
      </div>

      {action && (
        <div className="mt-2 space-y-2">
          {action === "FORWARD" && (
            <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="전달할 직원" className="w-full rounded-sm border-2 border-line bg-panel px-2 py-1">
              <option value="">전달할 직원 선택</option>
              {EMPLOYEES.filter((e) => e.id !== p.employeeId).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} · {e.title}
                </option>
              ))}
            </select>
          )}
          {action === "APPLY_TO_PROJECT" && (
            <div className="grid gap-1">
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="반영할 프로젝트" className="rounded-sm border-2 border-line bg-panel px-2 py-1">
                <option value="">프로젝트 선택</option>
                {p.projects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
              <input value={stage} onChange={(e) => setStage(e.target.value)} placeholder="현재 단계 (예: 기획, 개발 중)" className="rounded-sm border-2 border-line bg-panel px-2 py-1" />
              <input value={nextPlan} onChange={(e) => setNextPlan(e.target.value)} placeholder="다음 실행 계획" className="rounded-sm border-2 border-line bg-panel px-2 py-1" />
            </div>
          )}
          {action !== "APPLY_TO_PROJECT" && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={needsNote ? (action === "REVISION" ? "무엇을 고칠까요? (필수)" : "무엇을 더 분석할까요? (필수)") : "메모 (선택)"}
              className="w-full rounded-sm border-2 border-line bg-panel px-2 py-1"
            />
          )}
          {makesTask && (
            <div className="flex items-center gap-3 text-[12px] text-muted">
              후속 업무:
              <label className="flex items-center gap-1">
                <input type="radio" name="ra-mode" checked={mode === "manual"} onChange={() => setMode("manual")} /> 붙여넣기 (무료)
              </label>
              <label className={`flex items-center gap-1 ${p.apiReady ? "" : "opacity-50"}`}>
                <input type="radio" name="ra-mode" checked={mode === "api"} onChange={() => setMode("api")} disabled={!p.apiReady} /> API 자동
              </label>
            </div>
          )}
          {makesTask && <p className="text-[11px] text-muted">이 보고서 내용이 후속 업무의 입력 자료로 자동 첨부됩니다.</p>}
          <button
            type="button"
            onClick={submit}
            disabled={(needsNote && !note.trim()) || (action === "FORWARD" && !target) || (action === "APPLY_TO_PROJECT" && !projectId)}
            className="pixel w-full rounded-sm bg-hi py-1.5 font-bold text-void disabled:opacity-40"
          >
            {LABEL[action]} 확정
          </button>
        </div>
      )}
      {msg && <p className={`mt-2 text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}

      {(p.decisions.length > 0 || p.followUps.length > 0) && (
        <div className="mt-3 space-y-1 border-t border-line pt-2 text-[12px]" data-testid="report-history">
          {p.decisions.map((d) => (
            <div key={d.id}>
              <span className="text-muted">{d.decidedAt ? new Date(d.decidedAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</span>{" "}
              <b>{LABEL[d.decision ?? ""] ?? d.decision}</b>
              {d.note && <span className="text-muted"> — {d.note}</span>}
            </div>
          ))}
          {p.followUps.map((t) => (
            <div key={t.id} className="truncate">
              ↳ <span className="text-muted">{EMPLOYEE_BY_ID[t.employeeId]?.name}</span> {t.title} <span className="pixel text-info">{TASK_STATUS_LABEL[t.status as TaskStatus]}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
