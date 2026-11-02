"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { OfficeSnapshot } from "@/server/services/office";
import type { TaskEventRow } from "@/server/db/schema";
import { useOffice } from "@/store/officeStore";

export interface Health {
  /** The link version (browser-only, paste mode only). */
  lite?: boolean;
  db: { ok: boolean; error: string | null };
  ai: {
    keyConfigured: boolean;
    model: string;
    webSearch?: boolean;
    verified: boolean;
    lastError?: string | null;
    engineConnected: boolean;
    message: string;
  };
  worker: { running: boolean; message: string; activeTasks?: number };
}

export type LiveState = "connecting" | "live" | "reconnecting";

/**
 * Real data for the screen:
 * - snapshot from /api/office (the database)
 * - live task events over SSE (/api/events); every event triggers a snapshot reload,
 *   and a reconnect reloads everything so the screen matches the stored state.
 */
export function useOfficeData() {
  const [data, setData] = useState<OfficeSnapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveState>("connecting");
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/office", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
      return j as OfficeSnapshot;
    } catch (e) {
      setError(`서버에서 회사 데이터를 불러오지 못했습니다. (${(e as Error).message})`);
      return null;
    }
  }, []);

  const loadHealth = useCallback(async () => {
    try {
      const r = await fetch("/api/health", { cache: "no-store" });
      setHealth(await r.json());
    } catch {
      setHealth(null);
    }
  }, []);

  const scheduleReload = useCallback(() => {
    if (reloadTimer.current) return;
    reloadTimer.current = setTimeout(() => {
      reloadTimer.current = null;
      void load();
    }, 200);
  }, [load]);

  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let hadError = false;
    (async () => {
      const snap = await load();
      if (closed) return;
      es = new EventSource(`/api/events?after=${snap?.maxEventId ?? 0}`);
      es.onopen = () => {
        setLive("live");
        if (hadError) {
          // Reconnected: re-read the stored state rather than trusting what we missed.
          hadError = false;
          void load();
          void loadHealth();
        }
      };
      es.onerror = () => {
        hadError = true;
        setLive("reconnecting");
      };
      es.addEventListener("task", (m) => {
        const ev = JSON.parse((m as MessageEvent).data) as TaskEventRow;
        useOffice.getState().pushEvent(ev);
        scheduleReload();
        if (ev.type === "TASK_COMPLETED" || ev.type === "TASK_FAILED") void loadHealth();
      });
    })();
    loadHealth();
    const poll = setInterval(load, 30000); // safety net if events are missed
    const hp = setInterval(loadHealth, 10000);
    return () => {
      closed = true;
      es?.close();
      clearInterval(poll);
      clearInterval(hp);
    };
  }, [load, loadHealth, scheduleReload]);

  return { data, health, error, live, reload: load };
}
