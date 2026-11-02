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

export function desiredCommand(id: string, b: OfficeSnapshot["byEmployee"][string], now: number): Omit<ActorCommand, "id" | "source"> | null {
  const t = b.activeTask;
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
  const f = b.lastFinished;
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
      for (const [id, b] of Object.entries(data.byEmployee)) {
        const want = desiredCommand(id, b, now);
        const key = want ? JSON.stringify(want) : "release";
        if (applied.current[id] === key) continue;
        const prev = applied.current[id];
        applied.current[id] = key;
        if (want) toGame.emit("command", { id, ...want, source: "task" });
        else if (prev && prev !== "release") toGame.emit("release", id);
      }
    };
    apply();
    const t = setInterval(apply, 2000); // ends the "finished" display after its window
    return () => clearInterval(t);
  }, [data, ready]);
}
