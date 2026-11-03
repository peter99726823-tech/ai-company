"use client";
/**
 * Read a file the CEO attaches, in the browser. Only text leaves the browser (into the task),
 * never the file itself. PDFs go through pdf.js; scanned (image-only) PDFs have no text to extract.
 */
import { ATTACH_LIMITS, type Attachment } from "@/domain/attachments";
import { createPdfWorker } from "@/lib/pdfWorker";

const TEXT_EXT = ["txt", "md", "csv", "json", "tsv"];
export const ACCEPT = ".txt,.md,.csv,.tsv,.json,.pdf,text/plain,text/markdown,text/csv,application/pdf";

let pdfReady: Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> | null = null;
function pdfjs() {
  pdfReady ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
    m.GlobalWorkerOptions.workerPort = createPdfWorker();
    return m;
  });
  return pdfReady;
}

async function pdfText(file: File): Promise<string> {
  const lib = await pdfjs();
  // pdf.js 6 has no eval-based font path (the 2024 font-injection issue was fixed in 4.2); we only read text.
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const pages: string[] = [];
  let total = 0;
  for (let n = 1; n <= Math.min(doc.numPages, 300) && total < ATTACH_LIMITS.perFile * 1.2; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const line = tc.items.map((it) => ("str" in it ? it.str + (it.hasEOL ? "\n" : "") : "")).join("");
    pages.push(`[${n}쪽]\n${line.trim()}`);
    total += line.length;
  }
  await task.destroy();
  return pages.join("\n\n");
}

export async function readAttachment(file: File): Promise<Attachment> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: 파일이 너무 큽니다 (최대 20MB).`);
  let text: string;
  if (TEXT_EXT.includes(ext)) text = await file.text();
  else if (ext === "pdf") {
    text = await pdfText(file);
    if (!text.replace(/\[\d+쪽\]/g, "").trim()) throw new Error(`${file.name}: PDF에서 글자를 찾지 못했습니다. 스캔한 이미지 PDF일 수 있습니다. claude.ai에 파일을 직접 첨부해 주세요.`);
  } else throw new Error(`${file.name}: 이 형식은 아직 읽지 못합니다. (.txt .md .csv .pdf 가능) 한글·워드·엑셀은 내용을 복사해 붙여넣어 주세요.`);
  const clean = text.replace(/\u0000/g, "").trim();
  return { name: file.name, kind: ext, text: clean.slice(0, ATTACH_LIMITS.perFile), chars: clean.length, truncated: clean.length > ATTACH_LIMITS.perFile };
}
