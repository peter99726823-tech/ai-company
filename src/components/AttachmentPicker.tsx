"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { ATTACH_LIMITS, type Attachment } from "@/domain/attachments";
import { readAttachment, readFolder, collectDropped, foldersFromInput, ACCEPT, type FolderFile } from "@/lib/readAttachment";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

// A file dropped anywhere outside a drop area must not make the browser open it (and leave the app).
let guardInstalled = false;
function installPageGuard() {
  if (guardInstalled || typeof window === "undefined") return;
  guardInstalled = true;
  const stop = (e: DragEvent) => {
    if (hasFiles(e)) e.preventDefault();
  };
  window.addEventListener("dragover", stop);
  window.addEventListener("drop", stop);
}

/**
 * 파일 첨부: text/PDF files → extracted text chips. Controlled by the parent.
 * Files can be picked with the 📎 button or dragged onto `dropRef` (the whole form/window).
 */
export function AttachmentPicker({
  value,
  onChange,
  compact,
  dropRef,
}: {
  value: Attachment[];
  onChange: (a: Attachment[]) => void;
  compact?: boolean;
  dropRef?: RefObject<HTMLElement | null>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<DOMRect | null>(null);
  const latest = useRef(value);
  latest.current = value;

  async function add(files: FileList | File[] | null, folders: { name: string; entries: FolderFile[] }[] = []) {
    const list = files ? Array.from(files) : [];
    if (!list.length && !folders.length) return;
    setErr(null);
    setBusy(true);
    const next = [...latest.current];
    const errors: string[] = [];
    for (const f of list) {
      if (next.length >= ATTACH_LIMITS.files) {
        errors.push(`첨부는 최대 ${ATTACH_LIMITS.files}개까지입니다.`);
        break;
      }
      try {
        next.push(await readAttachment(f));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    for (const f of folders) {
      if (next.length >= ATTACH_LIMITS.files) {
        errors.push(`첨부는 최대 ${ATTACH_LIMITS.files}개까지입니다.`);
        break;
      }
      try {
        next.push(await readFolder(f.name, f.entries));
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setBusy(false);
    setErr(errors.length ? errors.join(" ") : null);
    onChange(next);
  }
  const addRef = useRef(add);
  addRef.current = add;

  useEffect(() => {
    installPageGuard();
    const el = dropRef?.current;
    if (!el) return;
    let depth = 0; // dragenter/leave fire for every child; count to know when we really left
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(el.getBoundingClientRect());
    };
    const overFn = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(null);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setOver(null);
      if (!e.dataTransfer) return;
      // Folders need their entries read now, while the drop event is still alive.
      setBusy(true);
      collectDropped(e.dataTransfer)
        .then(({ files, folders }) => addRef.current(files, folders))
        .catch((er) => {
          setBusy(false);
          setErr(`끌어놓은 항목을 읽지 못했습니다: ${(er as Error).message}`);
        });
    };
    el.addEventListener("dragenter", enter);
    el.addEventListener("dragover", overFn);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    return () => {
      el.removeEventListener("dragenter", enter);
      el.removeEventListener("dragover", overFn);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
    };
  }, [dropRef]);

  return (
    <div className="space-y-1" data-testid="attachments">
      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={id} className={`pixel cursor-pointer rounded-sm border-2 border-dashed border-line px-2 ${compact ? "py-0" : "py-0.5"} text-[11px] text-muted hover:border-hi hover:text-ink`}>
          {busy ? "읽는 중…" : "📎 파일 첨부"}
        </label>
        <input id={id} type="file" multiple accept={ACCEPT} className="hidden" aria-label="파일 첨부" onChange={(e) => (void add(e.target.files), (e.target.value = ""))} />
        <label htmlFor={`${id}-dir`} className={`pixel cursor-pointer rounded-sm border-2 border-dashed border-line px-2 ${compact ? "py-0" : "py-0.5"} text-[11px] text-muted hover:border-hi hover:text-ink`}>
          📁 폴더
        </label>
        <input
          id={`${id}-dir`}
          type="file"
          className="hidden"
          aria-label="폴더 첨부"
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(e) => {
            const fl = e.target.files;
            if (fl?.length) void add(null, foldersFromInput(fl));
            e.target.value = "";
          }}
        />
        {value.map((a, i) => (
          <span key={i} className="pixel flex items-center gap-1 rounded-sm bg-panel-2 px-1.5 py-0.5 text-[11px]" title={a.truncated ? `앞부분 ${a.text.length.toLocaleString()}자만 사용` : undefined}>
            {a.kind === "folder" ? "📁 " : ""}
            {a.name} <span className="text-muted">{a.chars.toLocaleString()}자{a.truncated ? "·일부" : ""}</span>
            <button type="button" aria-label={`${a.name} 빼기`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-muted hover:text-bad">
              ✕
            </button>
          </span>
        ))}
        {!compact && !value.length && <span className="text-[11px] text-muted">{dropRef ? "또는 파일·폴더를 이 창에 끌어다 놓으세요 · " : ""}텍스트 · HTML · 코드 · PDF</span>}
      </div>
      {err && <p className="text-[11px] text-bad">{err}</p>}
      {over && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none fixed z-50 grid place-items-center rounded-md border-4 border-dashed border-hi bg-void/80"
          style={{ left: over.left, top: over.top, width: over.width, height: over.height }}
        >
          <span className="pixel rounded-sm bg-hi px-3 py-1.5 text-[14px] font-bold text-void">여기에 놓으면 첨부됩니다 (파일·폴더 · 텍스트 HTML 코드 PDF)</span>
        </div>
      )}
    </div>
  );
}
