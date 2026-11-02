/**
 * Where the link version keeps its SQLite file.
 * - Inside claude.ai: the artifact's private database (owner/editors only), so the same records
 *   show up on any device. The file is split into chunks (documents are limited to 256 KiB) and
 *   written to alternating slots, so an interrupted save never damages the last good copy.
 * - Outside claude.ai (local testing): localStorage in this browser.
 */
type Db = {
  doc(path: string): { get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>; set(d: Record<string, unknown>): Promise<void> };
};

const CHUNK = 150_000;
const LS_KEY = "aico-lite-db";

function toB64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromB64(b64: string) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface Store {
  kind: "artifact" | "local";
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
}

export async function openStore(): Promise<Store> {
  const w = window as unknown as { claude?: { use(name: string): Promise<unknown> } };
  const db = (w.claude ? ((await w.claude.use("db").catch(() => null)) as Db | null) : null) ?? null;
  if (!db) {
    return {
      kind: "local",
      async load() {
        try {
          const v = localStorage.getItem(LS_KEY);
          return v ? fromB64(v) : null;
        } catch {
          return null;
        }
      },
      async save(bytes) {
        localStorage.setItem(LS_KEY, toB64(bytes));
      },
    };
  }
  let meta: { version: number; slot: number; count: number } | null = null;
  return {
    kind: "artifact",
    async load() {
      const m = await db.doc("sqlite/meta").get();
      if (!m.exists) return null;
      meta = m.data() as typeof meta;
      const parts: string[] = [];
      for (let i = 0; i < meta!.count; i++) {
        const c = await db.doc(`sqlite/s${meta!.slot}_c${i}`).get();
        const d = c.data() as { version: number; b64: string } | undefined;
        if (!d || d.version !== meta!.version) throw new Error("저장된 기록 조각이 맞지 않습니다. 새로고침해 보세요.");
        parts.push(d.b64);
      }
      return fromB64(parts.join(""));
    },
    async save(bytes) {
      const b64 = toB64(bytes);
      const version = (meta?.version ?? 0) + 1;
      const slot = meta ? 1 - meta.slot : 0; // write to the slot not currently in use
      const count = Math.ceil(b64.length / CHUNK);
      for (let i = 0; i < count; i++) await db.doc(`sqlite/s${slot}_c${i}`).set({ version, b64: b64.slice(i * CHUNK, (i + 1) * CHUNK) });
      await db.doc("sqlite/meta").set({ version, slot, count, savedAt: Date.now(), bytes: bytes.length });
      meta = { version, slot, count };
    },
  };
}
