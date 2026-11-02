"use client";
// Link-version replacement for src/hooks/useOfficeData.ts: no SSE; the in-browser router announces changes.
import { useEffect, useState, useCallback, useRef } from "react";
import type { OfficeSnapshot } from "@/server/services/office";
import { useOffice } from "@/store/officeStore";
import { onChange, LITE_HEALTH } from "./router";
import type { Health, LiveState } from "@/hooks/useOfficeData";

export type { Health, LiveState };

export function useOfficeData() {
  const [data, setData] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastEvent = useRef(0);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/office");
      const j = (await r.json()) as OfficeSnapshot & { error?: string };
      if (!r.ok) throw new Error(j.error);
      // Feed new events to the store like the SSE stream does (toasts, live log).
      const fresh = j.recentEvents.filter((e) => e.id > lastEvent.current).sort((a, b) => a.id - b.id);
      if (lastEvent.current > 0) fresh.forEach((e) => useOffice.getState().pushEvent(e));
      lastEvent.current = Math.max(lastEvent.current, j.maxEventId);
      setData(j);
      setError(null);
      return j;
    } catch (e) {
      setError(`기록을 불러오지 못했습니다. (${(e as Error).message})`);
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
    const off = onChange(() => void load());
    const t = setInterval(load, 10000); // keeps "recently finished" displays ticking
    return () => {
      off();
      clearInterval(t);
    };
  }, [load]);

  return { data, health: LITE_HEALTH as unknown as Health, error, live: "live" as LiveState, reload: load };
}
