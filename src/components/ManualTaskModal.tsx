"use client";

import { useOffice } from "@/store/officeStore";
import { ManualRun } from "./ManualRun";

/** Paste flow for a single (non-meeting) manual task. */
export function ManualTaskModal({ reload }: { reload: () => void }) {
  const id = useOffice((s) => s.manualTaskId);
  const close = () => useOffice.getState().openManual(null);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={close} role="dialog" aria-modal="true" aria-label="붙여넣기로 업무 처리">
      <div className="px-frame scroll-thin max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-md bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="pixel text-[15px] font-bold">붙여넣기로 업무 처리 (무료)</h2>
          <button type="button" onClick={close} className="pixel text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <ManualRun
          taskId={id}
          onDone={() => {
            reload();
            close();
          }}
        />
      </div>
    </div>
  );
}
