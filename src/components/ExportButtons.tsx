"use client";

import { useState } from "react";
import { saveFile, fileBase, markdownToDocx } from "@/lib/exportDoc";

/** 📋 copy · ⬇ Markdown · ⬇ Word for a report or meeting. */
export function ExportButtons({ title, markdown }: { title: string; markdown: () => string }) {
  const [msg, setMsg] = useState<string | null>(null);
  const btn = "pixel rounded-sm border-2 border-line bg-panel px-2 py-0.5 text-[11px] hover:border-hi";
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setMsg(code === "declined" ? "저장을 취소했습니다." : `저장하지 못했습니다${code ? ` (${code})` : ""}.`);
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-1" data-testid="export">
      <button type="button" className={btn} onClick={() => run(() => navigator.clipboard.writeText(markdown()), "복사했습니다")}>
        📋 복사
      </button>
      <button type="button" className={btn} onClick={() => run(() => saveFile(`${fileBase(title)}.md`, markdown(), "text/markdown"), "저장했습니다")}>
        ⬇ Markdown
      </button>
      <button type="button" className={btn} onClick={() => run(async () => saveFile(`${fileBase(title)}.docx`, await markdownToDocx(markdown(), title)), "저장했습니다")}>
        ⬇ Word
      </button>
      {msg && <span className="text-[11px] text-muted">{msg}</span>}
    </span>
  );
}
