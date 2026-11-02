"use client";
/** Shared dialog frame for the management windows. */
export function Modal({ label, onClose, children, wide }: { label: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={onClose} role="dialog" aria-modal="true" aria-label={label}>
      <div className={`px-frame flex max-h-[92dvh] w-full ${wide ? "max-w-4xl" : "max-w-2xl"} flex-col overflow-hidden rounded-md bg-panel`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b-2 border-line px-4 py-2">
          <h2 className="pixel text-[15px] font-bold">{label}</h2>
          <button type="button" onClick={onClose} className="pixel px-2 text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-4 text-[13px]">{children}</div>
      </div>
    </div>
  );
}

export const inputCls = "w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1";
export const btnCls = "pixel rounded-sm border-2 border-line bg-panel-2 px-2 py-1 text-[12px] hover:border-hi disabled:opacity-40";
export const primaryCls = "pixel rounded-sm bg-hi px-3 py-1.5 text-[13px] font-bold text-void disabled:opacity-40";

export async function api<T = Record<string, unknown>>(url: string, body?: unknown): Promise<{ ok: boolean; j: T & { error?: string } }> {
  const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, j };
}
