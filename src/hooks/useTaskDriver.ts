"use client";

import { useEffect, useRef } from "react";
import { toGame, type ActorCommand } from "@/game/bridge";
import type { OfficeSnapshot } from "@/server/services/office";

/**
 * Turns the server's real task state into character behaviour.
 * The mapping is derived from stored state (not from a stream of animations), so a reload or
 * reconnect always lands the characters in the right place. Animations never change task state.
 */
const SHOW_FINISHED_MS = 25_000;

type Want = Omit<ActorCommand, "id" | "source">;
const SPEAK_MS = 7000;

/** First sentence of a real statement, for a speech bubble. */
export function bubbleLine(text: string, max = 40): string {
  const plain = text.replace(/[#*_>`|\[\]]/g, "").replace(/\s+/g, " ").trim();
  const first = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/**
 * Meetings: participants sit in the meeting room while the meeting task is open.
 * After it completes, each participant's real statement is played back in speaking order.
 */
export function meetingWants(meetings: OfficeSnapshot["meetings"], now: number): Record<string, Want> {
  const out: Record<string, Want> = {};
  for (const m of [...meetings].reverse()) {
    const t = m.task;
    if (!t) continue;
    const ids = m.participants.map((p) => p.employeeId);
    if (["QUEUED", "PLANNING", "RUNNING"].includes(t.status)) {
      const manual = t.executionMode === "manual";
      for (const id of ids) {
        const bubble =
          id === "ceo-advisor"
            ? manual
              ? "대표님, claude.ai 답변을 붙여넣어 주세요"
              : t.statusMessage || "회의 진행 중..."
            : manual
              ? "회의 대기 중"
              : t.status === "RUNNING"
                ? "토론 중..."
                : "회의 준비 중";
        out[id] = { go: "meeting", activity: id === "ceo-advisor" && manual ? "waiting" : "meeting", bubble };
      }
    } else if (t.status === "COMPLETED" && m.endedAt) {
      const elapsed = now - m.endedAt;
      const total = (ids.length + 1) * SPEAK_MS;
      if (elapsed < 0 || elapsed > total) continue;
      const turn = Math.floor(elapsed / SPEAK_MS);
      ids.forEach((id, i) => {
        const p = m.participants[i];
        const speaking = turn === i && p.statement;
        out[id] = { go: "meeting", activity: "meeting", bubble: speaking ? bubbleLine(p.statement!) : turn >= ids.length && id === "ceo-advisor" ? "종합 완료 · 대표님 결정을 기다립니다" : null };
      });
    }
  }
  return out;
}

export function desiredCommand(id: string, b: OfficeSnapshot["byEmployee"][string], now: number): Want | null {
  const t = b.activeTask && b.activeTask.type !== "MEETING" ? b.activeTask : null;
  if (t && t.executionMode === "manual") return { go: "desk", activity: "waiting", bubble: "대표님 답변 붙여넣기 대기" };
  if (t) {
    switch (t.status) {
      case "QUEUED":
        return { go: "desk", activity: "thinking", bubble: "업무 확인 중..." };
      case "PLANNING":
        return { go: "desk", activity: "thinking", bubble: t.statusMessage || "계획 세우는 중..." };
      case "RUNNING":
        return { go: "desk", activity: "working", bubble: t.statusMessage || "작업 중..." };
      case "WAITING_APPROVAL":
        return { go: "report", activity: "waiting", bubble: "대표 승인 대기" };
    }
  }
  const f = b.lastFinished && b.lastFinished.type !== "MEETING" ? b.lastFinished : null;
  if (f && f.finishedAt && now - f.finishedAt < SHOW_FINISHED_MS) {
    if (f.status === "COMPLETED") return { go: "report", activity: "reporting", bubble: "업무 완료! 보고서 제출" };
    if (f.status === "FAILED") return { go: "stay", activity: "error", bubble: "업무 실패 · 사유 확인 필요" };
  }
  return null;
}

export function useTaskDriver(data: OfficeSnapshot | null, ready: boolean) {
  const applied = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!data || !ready) return;
    const apply = () => {
      const now = Date.now();
      const inMeeting = meetingWants(data.meetings ?? [], now);
      for (const [id, b] of Object.entries(data.byEmployee)) {
        const want = inMeeting[id] ?? desiredCommand(id, b, now);
        const key = want ? JSON.stringify(want) : "release";
        if (applied.current[id] === key) continue;
        const prev = applied.current[id];
        applied.current[id] = key;
        if (want) toGame.emit("command", { id, ...want, source: "task" });
        else if (prev && prev !== "release") toGame.emit("release", id);
      }
    };
    apply();
    const t = setInterval(apply, 1000); // advances meeting playback and ends "finished" displays
    return () => clearInterval(t);
  }, [data, ready]);
}
