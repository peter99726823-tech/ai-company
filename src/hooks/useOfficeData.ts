"use client";

import { useEffect, useState, useCallback } from "react";
import type { OfficeSnapshot } from "@/server/services/office";

export interface Health {
  db: { ok: boolean; error: string | null };
  ai: { keyConfigured: boolean; model: string; verified: boolean; engineConnected: boolean; message: string };
  worker: { running: boolean; message: string };
}

/**
 * PHASE 1: polls the real database snapshot every 5 s.
 * PHASE 2 replaces the polling with an SSE stream (+ full reload on reconnect).
 */
export function useOfficeData() {
  const [data, setData] = useState<OfficeSnapshot | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/office", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
      setError(null);
    } catch (e) {
      setError(`서버에서 회사 데이터를 불러오지 못했습니다. (${(e as Error).message})`);
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

  useEffect(() => {
    load();
    loadHealth();
    const a = setInterval(load, 5000);
    const b = setInterval(loadHealth, 30000);
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, [load, loadHealth]);

  return { data, health, error, reload: load };
}
