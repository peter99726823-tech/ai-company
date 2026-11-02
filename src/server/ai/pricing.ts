/**
 * Price table used to turn real token usage into an estimated cost.
 * Prices are USD per 1M tokens, from Anthropic's published table (2026-10).
 * The resulting cost is an estimate: the real bill is in the Claude Console.
 */
export const PRICE_TABLE_VERSION = "anthropic-2026-10";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number; // 5-minute cache write (1.25x input)
}

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

/** Web search is billed per search (USD 10 per 1,000 searches). */
const WEB_SEARCH_USD = 0.01;

export interface UsageLike {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

/** Returns micro-dollars and whether the model had a known price. */
export function estimateCostMicros(model: string, u: UsageLike, webSearches = 0): { micros: number; known: boolean } {
  const p = PRICES[model];
  const price = p ?? PRICES["claude-opus-5-5"];
  const usd =
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      (u.cache_read_input_tokens ?? 0) * price.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
      1_000_000 +
    webSearches * WEB_SEARCH_USD;
  return { micros: Math.round(usd * 1_000_000), known: !!p };
}
