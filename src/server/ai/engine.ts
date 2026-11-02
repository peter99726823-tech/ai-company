/**
 * AI Agent Engine: one streamed Claude call that writes a report.
 * Runs only in the worker process (never in the browser). The API key is read from env.
 *
 * Progress callbacks report what is actually happening on the stream
 * (thinking started, a section heading arrived, a web search ran) — never elapsed time.
 */
import Anthropic from "@anthropic-ai/sdk";

export interface EngineConfig {
  model: string;
  webSearch: boolean;
  /** Server-side refusal fallback ("default" routes by refusal category). Off for Haiku, which has none. */
  fallbacks: boolean;
  maxTokens: number;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
}

export function engineConfigFromEnv(): EngineConfig {
  const model = process.env.AI_MODEL?.trim() || "claude-opus-5-5";
  return {
    model,
    webSearch: (process.env.AI_WEB_SEARCH ?? "off").toLowerCase() === "on",
    fallbacks: (process.env.AI_FALLBACKS ?? "default") !== "off" && !model.includes("haiku"),
    maxTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS ?? 32000),
    effort: (process.env.AI_EFFORT as EngineConfig["effort"]) || "high",
  };
}

export type Progress =
  | { kind: "thinking" }
  | { kind: "writing"; section: string | null; chars: number }
  | { kind: "tool_start"; name: string; query?: string }
  | { kind: "tool_done"; name: string; results: number };

export interface EngineResult {
  text: string;
  stopReason: string | null;
  refusalCategory: string | null;
  model: string; // the model that actually served the response
  requestId: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  webSearches: number;
  sources: { title: string; url: string }[];
}

export class MissingApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 키를 넣고 실행기(워커)를 다시 시작하세요.");
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) throw new MissingApiKeyError();
  // Retries are done by the orchestrator so that every call is counted and logged.
  client ??= new Anthropic({ maxRetries: 0, timeout: 15 * 60 * 1000 });
  return client;
}

export async function runReport(opts: {
  cfg: EngineConfig;
  system: string;
  user: string;
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}): Promise<EngineResult> {
  const { cfg } = opts;
  const anthropic = getClient();

  const tools: Anthropic.Beta.BetaToolUnion[] = cfg.webSearch ? [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }] : [];
  const betas: Anthropic.Beta.AnthropicBeta[] = cfg.fallbacks ? ["server-side-fallback-2026-07-01"] : [];

  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.user }];
  const total = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let text = "";
  let webSearches = 0;
  const sources = new Map<string, string>();
  let last: Anthropic.Beta.BetaMessage | null = null;
  let requestId: string | null = null;

  // A server-tool turn can pause (pause_turn); continue it a bounded number of times.
  for (let turn = 0; turn < 4; turn++) {
    const stream = anthropic.beta.messages.stream(
      {
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: cfg.effort },
        ...(tools.length ? { tools } : {}),
        ...(betas.length ? { betas, fallbacks: "default" as const } : {}),
      },
      { signal: opts.signal },
    );

    let section: string | null = null;
    let lineBuf = "";
    for await (const ev of stream) {
      if (ev.type === "content_block_start") {
        const b = ev.content_block;
        if (b.type === "thinking") opts.onProgress({ kind: "thinking" });
        if (b.type === "server_tool_use" && b.name === "web_search") opts.onProgress({ kind: "tool_start", name: "web_search" });
        if (b.type === "web_search_tool_result") {
          const c = b.content;
          if (Array.isArray(c)) {
            webSearches++;
            for (const r of c) if (r.type === "web_search_result") sources.set(r.url, r.title);
            opts.onProgress({ kind: "tool_done", name: "web_search", results: c.length });
          } else {
            opts.onProgress({ kind: "tool_done", name: "web_search", results: 0 });
          }
        }
      } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        text += ev.delta.text;
        lineBuf += ev.delta.text;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const l of lines) {
          const m = /^##\s+(.+)$/.exec(l.trim());
          if (m) section = m[1].trim();
        }
        opts.onProgress({ kind: "writing", section, chars: text.length });
      }
    }
    last = await stream.finalMessage();
    requestId = stream.request_id ?? requestId;
    total.input_tokens += last.usage.input_tokens;
    total.output_tokens += last.usage.output_tokens;
    total.cache_read_input_tokens += last.usage.cache_read_input_tokens ?? 0;
    total.cache_creation_input_tokens += last.usage.cache_creation_input_tokens ?? 0;

    if (last.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: last.content as Anthropic.Beta.BetaContentBlockParam[] });
  }

  return {
    text,
    stopReason: last?.stop_reason ?? null,
    refusalCategory: last?.stop_reason === "refusal" ? (last.stop_details?.category ?? null) : null,
    model: last?.model ?? cfg.model,
    requestId,
    usage: total,
    webSearches,
    sources: [...sources].map(([url, title]) => ({ url, title })),
  };
}

/** Classify an error for the orchestrator: retryable (429/5xx/network) or final, with a Korean message. */
export function describeError(e: unknown): { retryable: boolean; message: string; aborted: boolean } {
  if (e instanceof MissingApiKeyError) return { retryable: false, message: e.message, aborted: false };
  if (e instanceof Anthropic.APIUserAbortError) return { retryable: false, message: "대표가 업무를 취소했습니다.", aborted: true };
  if (e instanceof Anthropic.AuthenticationError) return { retryable: false, message: "API 키가 올바르지 않습니다 (401). 키를 확인하세요.", aborted: false };
  if (e instanceof Anthropic.PermissionDeniedError) return { retryable: false, message: "이 키로는 해당 모델이나 기능을 쓸 권한이 없습니다 (403).", aborted: false };
  if (e instanceof Anthropic.NotFoundError) return { retryable: false, message: "모델 이름을 찾을 수 없습니다 (404). AI_MODEL 값을 확인하세요.", aborted: false };
  if (e instanceof Anthropic.BadRequestError) return { retryable: false, message: `요청이 거부되었습니다 (400): ${e.message}`, aborted: false };
  if (e instanceof Anthropic.RateLimitError) return { retryable: true, message: "요청 한도에 걸렸습니다 (429).", aborted: false };
  if (e instanceof Anthropic.InternalServerError) return { retryable: true, message: `Anthropic 서버 오류 (${e.status}).`, aborted: false };
  if (e instanceof Anthropic.APIConnectionError) return { retryable: true, message: "Anthropic API에 연결하지 못했습니다 (네트워크).", aborted: false };
  if (e instanceof Anthropic.APIError) return { retryable: (e.status ?? 0) >= 500, message: `API 오류 ${e.status ?? ""}: ${e.message}`, aborted: false };
  return { retryable: false, message: `알 수 없는 오류: ${(e as Error)?.message ?? String(e)}`, aborted: false };
}
