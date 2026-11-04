"use client";

import { useOffice } from "@/store/officeStore";
import { useSample } from "@/lib/claudeSample";
import { ManualRun } from "./ManualRun";

/**
 * A single (non-meeting) task without an API key. Right after it is created (업무 지시, 추가 분석,
 * 수정 요청, 전달…) Claude writes it immediately when available; otherwise the paste flow.
 * When it is saved, the new report opens.
 */
export function ManualTaskModal({ reload }: { reload: () => void }) {
  const id = useOffice((s) => s.manualTaskId);
  const auto = useOffice((s) => !!s.manualTaskId && s.autoTaskId === s.manualTaskId);
  const sample = useSample();
  const close = () => useOffice.getState().openManual(null);
  if (!id) return null;
  const claude = typeof sample === "function";
  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/60 p-3" onClick={close} role="dialog" aria-modal="true" aria-label="업무 처리">
      <div className="px-frame scroll-thin max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-md bg-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="pixel text-[15px] font-bold">{claude ? "⚡ 업무 처리 (Claude 자동 · 붙여넣기)" : "붙여넣기로 업무 처리 (무료)"}</h2>
          <button type="button" onClick={close} className="pixel text-muted hover:text-ink" aria-label="닫기">
            ✕
          </button>
        </div>
        <ManualRun
          key={id}
          taskId={id}
          autoStart={auto}
          onDone={(r) => {
            reload();
            close();
            const rid = (r as { reportId?: string } | undefined)?.reportId;
            if (rid) useOffice.getState().openReport(rid);
          }}
        />
      </div>
    </div>
  );
}
