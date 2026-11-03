"use client";

import { useCallback, useEffect, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/domain/types";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";
import { Modal, api, inputCls, btnCls, primaryCls } from "./Modal";

const STATUS: Record<string, string> = { new: "새 아이디어", reviewing: "검토 중", active: "진행", hold: "보류", dropped: "폐기" };
interface Idea {
  id: string;
  title: string;
  body: string;
  status: string;
  projectId: string | null;
  linkedTaskId: string | null;
  linkedMeetingId: string | null;
  taskStatus: string | null;
  reportId: string | null;
  meetingStatus: string | null;
  createdAt: number;
}

/** 아이디어 메모함: jot ideas down; later send one to a meeting or to 서진 for validation. */
export function IdeasModal({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const open = useOffice((s) => s.panel === "ideas");
  const close = () => useOffice.getState().setPanel(null);
  const lastEvent = useOffice((s) => s.liveEvents[0]?.id);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [projectId, setProjectId] = useState("");
  const [filter, setFilter] = useState("open");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;

  const load = useCallback(async () => {
    const r = await fetch("/api/ideas");
    setIdeas((await r.json()).ideas ?? []);
  }, []);
  useEffect(() => {
    if (open) void load();
  }, [open, load, lastEvent]);
  if (!open) return null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { ok, j } = await api("/api/ideas", { title, body, projectId: projectId || null });
    setMsg({ ok, t: ok ? "적어 두었습니다." : (j.error ?? "저장하지 못했습니다.") });
    if (ok) {
      setTitle("");
      setBody("");
      void load();
      reload();
    }
  }
  async function act(id: string, what: "validate" | "meeting" | "delete" | "update", payload: unknown = {}) {
    const { ok, j } = await api<{ meetingId?: string; taskId?: string }>(`/api/ideas/${id}/${what}`, { executionMode: apiReady ? "api" : "manual", ...(payload as object) });
    if (!ok) return setMsg({ ok: false, t: j.error ?? "처리하지 못했습니다." });
    void load();
    reload();
    if (what === "meeting" && j.meetingId) {
      close();
      useOffice.getState().openMeeting(j.meetingId);
    }
    if (what === "validate" && j.taskId) {
      setMsg({ ok: true, t: apiReady ? "서진에게 검증을 맡겼습니다." : "서진에게 검증을 맡겼습니다. 지시문을 claude.ai에 붙여넣어 주세요." });
      if (!apiReady) {
        close();
        useOffice.getState().openManual(j.taskId);
      }
    }
  }

  const shown = ideas.filter((i) => (filter === "open" ? !["dropped", "hold"].includes(i.status) : filter === "all" ? true : i.status === filter));

  return (
    <Modal label="아이디어 메모함" onClose={close} wide>
      <form onSubmit={add} className="space-y-2 rounded-sm border-2 border-line p-3">
        <input id="idea-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="떠오른 아이디어 한 줄 (예: 동네 카페 재고를 사진으로 세는 앱)" className={inputCls} aria-label="아이디어" />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="메모 (선택): 누가 불편한지, 왜 떠올랐는지, 참고한 것" className={inputCls} aria-label="아이디어 메모" />
        <div className="flex flex-wrap items-center gap-2">
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="아이디어 프로젝트" className="rounded-sm border-2 border-line bg-panel-2 px-2 py-1">
            <option value="">프로젝트 없음</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!title.trim()} className={`${primaryCls} ml-auto`}>
            적어 두기
          </button>
        </div>
        {msg && <p className={`text-[12px] ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.t}</p>}
      </form>

      <div className="mt-3 flex flex-wrap gap-1">
        {[["open", "열린 것"], ["all", "전체"], ...Object.entries(STATUS)].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={`pixel rounded-sm px-2 py-0.5 text-[11px] ${filter === k ? "bg-hi text-void" : "bg-panel-2 text-muted"}`}>
            {l}
          </button>
        ))}
      </div>

      <ul className="mt-2 space-y-2" data-testid="ideas">
        {shown.map((i) => (
          <li key={i.id} className={`rounded-sm border border-line p-2 ${i.status === "dropped" ? "opacity-50" : ""}`}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <b>{i.title}</b>
                {i.body && <p className="whitespace-pre-wrap text-[12px] text-muted">{i.body}</p>}
                <div className="mt-1 text-[11px] text-muted">
                  {new Date(i.createdAt).toLocaleDateString("ko-KR")}
                  {i.linkedTaskId && (
                    <>
                      {" · 서진 검증 "}
                      <span className="text-info">{TASK_STATUS_LABEL[(i.taskStatus ?? "QUEUED") as TaskStatus]}</span>
                      {i.reportId && (
                        <button type="button" className="ml-1 text-hi underline" onClick={() => useOffice.getState().openReport(i.reportId)}>
                          보고서
                        </button>
                      )}
                    </>
                  )}
                  {i.linkedMeetingId && (
                    <>
                      {" · 회의 "}
                      <button type="button" className="text-hi underline" onClick={() => (close(), useOffice.getState().openMeeting(i.linkedMeetingId))}>
                        {i.meetingStatus === "COMPLETED" ? "회의록" : "회의실"}
                      </button>
                    </>
                  )}
                </div>
              </div>
              <select value={i.status} onChange={(e) => act(i.id, "update", { status: e.target.value })} aria-label="아이디어 상태" className="rounded-sm border-2 border-line bg-panel-2 px-1 py-0.5 text-[12px]">
                {Object.entries(STATUS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              <button type="button" className={btnCls} onClick={() => act(i.id, "validate")} disabled={!!i.linkedTaskId && i.taskStatus !== "FAILED" && i.taskStatus !== "CANCELED"}>
                서진에게 검증 맡기기
              </button>
              <button type="button" className={btnCls} onClick={() => act(i.id, "meeting")} disabled={!!i.linkedMeetingId}>
                회의 열기
              </button>
              <button type="button" className={`${btnCls} ml-auto`} onClick={() => act(i.id, "delete")}>
                삭제
              </button>
            </div>
          </li>
        ))}
        {!shown.length && <li className="text-[12px] text-muted">아직 적어 둔 아이디어가 없습니다.</li>}
      </ul>
    </Modal>
  );
}
