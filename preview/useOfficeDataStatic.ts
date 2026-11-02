"use client";
// Preview build only: replaces src/hooks/useOfficeData.ts. No server exists in the preview,
// so the page shows a frozen copy of the real database snapshot taken at build time.
import snapshot from "./snapshot.json";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

const health: Health = {
  db: { ok: true, error: null },
  ai: {
    keyConfigured: false,
    model: "claude-opus-5-5",
    verified: false,
    engineConnected: false,
    message: "미리보기 페이지에는 서버가 없어 AI 기능이 꺼져 있습니다.",
  },
  worker: { running: false, message: "미리보기 페이지에는 업무 실행기가 없습니다." },
};

export function useOfficeData() {
  return { data: snapshot as unknown as OfficeSnapshot, health, error: null as string | null, live: "connecting" as const, reload: async () => null };
}
export type { Health };
