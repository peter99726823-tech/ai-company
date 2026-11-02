"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import { ManualRun } from "./ManualRun";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

interface Chat {
  conversation: { id: string } | null;
  messages: { id: string; role: string; content: string; createdAt: number }[];
  pending: { id: string; status: string; executionMode: string; statusMessage: string | null } | null;
  failed: { id: string; error: string | null } | null;
}

const md = (t: string) => DOMPurify.sanitize(marked.parse(t, { async: false }) as string);

/** 1:1 chat with an employee, kept separately per project. */
export function ChatModal({ data, health, reload }: { data: OfficeSnapshot | null; health: Health | null; reload: () => void }) {
  const id = useOffice((s) => s.chatEmployeeId);
  const lastEvent = useOffice((s) => s.liveEvents[0]?.id);
  const close = () => useOffice.getState().openChat(null);
  const [projectId, setProjectId] = useState("");
  const [chat, setChat] = useState<Chat | null>(null);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apiReady = !!health?.worker.running && !!health?.ai.keyConfigured;
  const [mode, setMode] = useState<"manual" | "api">("manual");
  const listRef = useRef<HTMLDivElement>(null);
  const emp = id ? EMPLOYEE_BY_ID[id] : null;
  const portrait = useMemo(() => (emp ? portraitDataUrl(emp.look, 3) : ""), [emp]);

  const load = useCallback(async () => {
    if (!id) return;
    const r = await fetch(`/api/chat/${id}${projectId ? `?projectId=${projectId}` : ""}`);
    const j = await r.json();
    if (r.ok) setChat(j);
    else setErr(j.error);
  }, [id, projectId]);

  useEffect(() => {
    setChat(null);
    setErr(null);
    void load();
  }, [load]);
  useEffect(() => {
    void load();
  }, [lastEvent, load]);
  useEffect(() => setMode(apiReady ? "api" : "manual"), [apiReady]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat?.messages.length, chat?.pending?.id]);

  if (!id || !emp) return null;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/chat/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, projectId: projectId || null, executionMode: mode }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) {
      setErr(j.error);
      return;
    }
    setText("");
    setChat(j);
    reload();
  }

  const pendingManual = chat?.pending && chat.pending.executionMode === "manual" && chat.pending.status === "QUEUED";

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={close} role="dialog" aria-modal="true" aria-label={`${emp.name}와 대화`}>
      <div className="px-frame flex h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-md bg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b-2 border-line p-3" style={{ boxShadow: `inset 0 3px 0 ${emp.look.accent}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={portrait} alt="" width={32} height={48} className="pixelated h-12 w-8" />
          <div className="min-w-0 flex-1">
            <div className="pixel text-[15px] font-bold">{emp.name}와 대화</div>
            <div className="text-[12px] text-muted">{emp.title}</div>
          </div>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="대화 프로젝트" className="max-w-[40%] rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[12px]">
            <option value="">프로젝트 없음</option>
            {data?.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={close} className="pixel px-2 text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>

        <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3" data-testid="chat-list">
          {!chat?.messages.length && <p className="text-[13px] text-muted">{projectId ? "이 프로젝트에 대한" : "새"} 대화를 시작하세요. 프로젝트마다 대화 기록이 따로 남습니다.</p>}
          {chat?.messages.map((m) =>
            m.role === "ceo" ? (
              <div key={m.id} className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-md bg-hi/15 px-3 py-2 text-[13px]" data-role="ceo">
                {m.content}
              </div>
            ) : (
              <div key={m.id} className="report max-w-[90%] rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px]" data-role="employee" dangerouslySetInnerHTML={{ __html: md(m.content) }} />
            ),
          )}
          {chat?.pending && !pendingManual && <p className="pixel text-[12px] text-info">{emp.name}이(가) 답변을 쓰는 중… {chat.pending.statusMessage}</p>}
          {pendingManual && (
            <div className="rounded-md border border-hi/40 p-2">
              <ManualRun taskId={chat!.pending!.id} submitLabel="답변 넣기" onDone={() => (reload(), void load())} />
            </div>
          )}
          {chat?.failed && (
            <p className="rounded-sm bg-bad/10 p-2 text-[12px] text-bad">
              답변 실패: {chat.failed.error}{" "}
              <button type="button" className="underline" onClick={async () => (await fetch(`/api/tasks/${chat.failed!.id}/retry`, { method: "POST" }), reload(), void load())}>
                다시 시도
              </button>
            </p>
          )}
        </div>

        <form onSubmit={send} className="space-y-1 border-t-2 border-line p-3">
          {err && <p className="text-[12px] text-bad">{err}</p>}
          <div className="flex gap-2">
            <textarea
              id="chat-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
              rows={2}
              disabled={!!chat?.pending}
              placeholder={chat?.pending ? "답변을 받은 뒤에 이어서 말할 수 있습니다" : `${emp.name}에게 물어보세요 (Enter 보내기, Shift+Enter 줄바꿈)`}
              className="min-w-0 flex-1 resize-none rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5 text-[13px] disabled:opacity-50"
            />
            <button type="submit" disabled={busy || !text.trim() || !!chat?.pending} className="pixel shrink-0 rounded-sm bg-hi px-4 text-[13px] font-bold text-void disabled:opacity-40">
              보내기
            </button>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <label className="flex items-center gap-1">
              <input type="radio" name="chat-mode" checked={mode === "manual"} onChange={() => setMode("manual")} /> 붙여넣기 (무료)
            </label>
            <label className={`flex items-center gap-1 ${apiReady ? "" : "opacity-50"}`}>
              <input type="radio" name="chat-mode" checked={mode === "api"} onChange={() => setMode("api")} disabled={!apiReady} /> API 자동
            </label>
          </div>
        </form>
      </div>
    </div>
  );
}
