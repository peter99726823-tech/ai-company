"use client";

import { useId, useState } from "react";
import { ATTACH_LIMITS, type Attachment } from "@/domain/attachments";
import { readAttachment, ACCEPT } from "@/lib/readAttachment";

/** 파일 첨부: text/PDF files → extracted text chips. Controlled by the parent. */
export function AttachmentPicker({ value, onChange, compact }: { value: Attachment[]; onChange: (a: Attachment[]) => void; compact?: boolean }) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setErr(null);
    setBusy(true);
    const next = [...value];
    for (const f of Array.from(files)) {
      if (next.length >= ATTACH_LIMITS.files) {
        setErr(`첨부는 최대 ${ATTACH_LIMITS.files}개까지입니다.`);
        break;
      }
      try {
        next.push(await readAttachment(f));
      } catch (e) {
        setErr((e as Error).message);
      }
    }
    setBusy(false);
    onChange(next);
  }

  return (
    <div className="space-y-1" data-testid="attachments">
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className={`pixel cursor-pointer rounded-sm border-2 border-dashed border-line px-2 ${compact ? "py-0" : "py-0.5"} text-[11px] text-muted hover:border-hi hover:text-ink`}>
          {busy ? "읽는 중…" : "📎 파일 첨부"}
        </label>
        <input id={id} type="file" multiple accept={ACCEPT} className="hidden" aria-label="파일 첨부" onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
        {value.map((a, i) => (
          <span key={i} className="pixel flex items-center gap-1 rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px]" title={a.truncated ? `앞부분 ${a.text.length.toLocaleString()}자만 사용` : undefined}>
            {a.name} <span className="text-muted">{a.chars.toLocaleString()}자{a.truncated ? "·일부" : ""}</span>
            <button type="button" aria-label={`${a.name} 빼기`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted hover:text-bad">
              ✕
            </button>
          </span>
        ))}
        {!compact && !value.length && <span className="text-[11px] text-muted">.txt .md .csv .pdf · 내용이 지시문에 붙습니다</span>}
      </div>
      {err && <p className="text-[11px] text-bad">{err}</p>}
    </div>
  );
}
