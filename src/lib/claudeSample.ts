"use client";
/**
 * "Claude 자동" for the link version: when the page runs inside claude.ai as an artifact that declares
 * the `sample` capability, it can ask Claude on the viewer's own claude.ai account (no API key).
 * Everywhere else (PC version, plain browser) this resolves to null and the UI hides the option.
 */
import { useEffect, useState } from "react";

export interface SampleResult {
  text: string;
  truncated: boolean;
}
export interface SampleError {
  code: string;
  message: string;
  text?: string;
}
type SampleFn = ((input: string, opts?: { onText?: (p: { text: string }) => void; signal?: AbortSignal; modelTier?: string; cache?: boolean }) => Promise<SampleResult>) & {
  limits?: () => Promise<{ maxPromptBytes: number }>;
};

let ready: Promise<SampleFn | null> | null = null;
export function getSample(): Promise<SampleFn | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  ready ??= (async () => {
    const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
    if (!c?.use) return null;
    try {
      return ((await c.use("sample")) as SampleFn | null) ?? null;
    } catch {
      return null;
    }
  })();
  return ready;
}

/** null = still checking, false = not available here, function = available. */
export function useSample(): SampleFn | null | false {
  const [s, setS] = useState<SampleFn | null | false>(null);
  useEffect(() => {
    let live = true;
    void getSample().then((f) => live && setS(() => f ?? false)); // wrap: a bare function would be taken as an updater
    return () => {
      live = false;
    };
  }, []);
  return s;
}

export const MAX_PROMPT_BYTES = 262_144;
export const promptBytes = (s: string) => new TextEncoder().encode(s).length;

/** Viewer-facing explanation for a sample error code. */
export function sampleErrorText(e: SampleError): string {
  switch (e.code) {
    case "not_granted":
      return "Claude 사용을 허용하지 않아 자동 진행을 쓸 수 없습니다. 아래 복사·붙여넣기 방식으로 진행하세요.";
    case "sampling_disabled":
    case "capability_disabled":
    case "not_declared":
    case "capability_removed":
      return "이 화면에서는 Claude 자동 진행을 쓸 수 없습니다. 복사·붙여넣기 방식으로 진행하세요.";
    case "rate_limited":
      return "claude.ai 사용량 한도에 걸렸거나 요청이 너무 많습니다. 잠시 뒤 다시 누르거나 붙여넣기 방식을 쓰세요.";
    case "session_expired":
      return "claude.ai 로그인이 만료됐습니다. 다시 로그인한 뒤 시도하세요.";
    case "prompt_too_large":
      return "지시문이 너무 깁니다(첨부가 큼). 첨부를 줄이거나 붙여넣기 방식을 쓰세요.";
    case "refused":
      return "Claude가 이 요청에 답하지 않았습니다. 주제 문구를 바꿔 다시 시도하세요.";
    case "empty_completion":
      return "Claude가 빈 답을 보냈습니다. 다시 시도하거나 붙여넣기 방식을 쓰세요.";
    case "cancelled":
      return "중지했습니다.";
    default:
      return "연결이 끊겼습니다. 다시 누르거나 붙여넣기 방식을 쓰세요.";
  }
}
