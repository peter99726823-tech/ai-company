"use client";
/**
 * Read a file the CEO attaches, in the browser. Only text leaves the browser (into the task),
 * never the file itself. PDFs go through pdf.js; scanned (image-only) PDFs have no text to extract.
 */
import { ATTACH_LIMITS, type Attachment } from "@/domain/attachments";
import { createPdfWorker } from "@/lib/pdfWorker";

// Text and source-code files are read as-is (HTML keeps its source: useful for reviewing pages and games).
const TEXT_EXT = [
  "txt", "md", "markdown", "csv", "tsv", "json", "html", "htm", "css", "scss", "js", "mjs", "cjs", "jsx", "ts", "tsx",
  "py", "java", "kt", "go", "rb", "php", "c", "h", "cpp", "cs", "swift", "dart", "rs", "sql", "xml", "svg", "yml", "yaml",
  "toml", "ini", "env.example", "sh", "vue", "svelte", "gd", "lua", "txt",
];
export const ACCEPT = `${TEXT_EXT.map((e) => `.${e}`).join(",")},.pdf,text/plain,text/markdown,text/csv,text/html,application/pdf`;
const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
export const isReadable = (name: string) => TEXT_EXT.includes(extOf(name)) || extOf(name) === "pdf";

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
  } else throw new Error(`${file.name}: 이 형식은 아직 읽지 못합니다. (텍스트·HTML·코드·PDF 가능) 한글·워드·엑셀·이미지는 내용을 복사해 붙여넣거나 claude.ai에 직접 첨부해 주세요.`);
  const clean = text.replace(/\u0000/g, "").trim();
  return { name: file.name, kind: ext, text: clean.slice(0, ATTACH_LIMITS.perFile), chars: clean.length, truncated: clean.length > ATTACH_LIMITS.perFile };
}

// ─── folders ───────────────────────────────────────────────────────

export interface FolderFile {
  path: string; // relative path inside the folder, e.g. "src/game.js"
  file: File;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "dist", "build", ".cache", "__pycache__", ".venv", "venv", ".idea", ".vscode", "coverage"]);
const PER_FILE_IN_FOLDER = 15_000;
const MAX_FILES_READ = 200;

/** Is this path inside a folder we never read (dependencies, build output, VCS)? */
export const skippedDir = (path: string) => path.split("/").slice(0, -1).some((seg) => SKIP_DIRS.has(seg));

/**
 * Bundle a folder into one attachment: the file tree first, then each readable file's contents.
 * Unreadable files (images, archives, office documents) are listed but not read, and counted.
 */
export async function readFolder(name: string, entries: FolderFile[]): Promise<Attachment> {
  const visible = entries.filter((e) => !skippedDir(e.path)).sort((a, b) => a.path.localeCompare(b.path));
  const hiddenByDir = entries.length - visible.length;
  const limit = ATTACH_LIMITS.perFolder;
  const tree = visible.map((e) => `  ${e.path}${isReadable(e.path) ? "" : "  (읽지 않음)"}`).join("\n");
  const parts: string[] = [];
  let used = 0;
  let read = 0;
  let notRead = 0;
  let cut = false;
  for (const e of visible) {
    if (!isReadable(e.path)) {
      notRead++;
      continue;
    }
    if (read >= MAX_FILES_READ || used >= limit) {
      cut = true;
      continue;
    }
    try {
      const a = await readAttachment(e.file);
      const body = a.text.slice(0, PER_FILE_IN_FOLDER);
      const chunk = `[파일: ${e.path}]${a.chars > body.length ? ` (앞부분 ${body.length.toLocaleString()}자 / 전체 ${a.chars.toLocaleString()}자)` : ""}\n${body}`;
      parts.push(chunk);
      used += chunk.length;
      read++;
    } catch {
      notRead++;
    }
  }
  if (!read) throw new Error(`${name}: 폴더 안에서 읽을 수 있는 파일(텍스트·HTML·코드·PDF)을 찾지 못했습니다.`);
  const header =
    `폴더: ${name} — 파일 ${visible.length}개 중 ${read}개 읽음` +
    (notRead ? `, ${notRead}개는 형식상 읽지 않음` : "") +
    (hiddenByDir ? `, node_modules·.git·빌드 폴더의 파일 ${hiddenByDir}개 제외` : "") +
    (cut ? ", 분량 한도로 나머지 파일 생략" : "");
  const full = `${header}\n\n[폴더 구조]\n${name}/\n${tree}\n\n${parts.join("\n\n")}`;
  return { name: `${name}/`, kind: "folder", text: full.slice(0, limit), chars: full.length, truncated: cut || full.length > limit };
}

/**
 * Collect what was dropped: plain files, and folders walked recursively.
 * Must be called synchronously inside the drop handler (items are only readable then).
 */
export function collectDropped(dt: DataTransfer): Promise<{ files: File[]; folders: { name: string; entries: FolderFile[] }[] }> {
  const items = Array.from(dt.items ?? []).filter((i) => i.kind === "file");
  const entries = items.map((i) => (typeof i.webkitGetAsEntry === "function" ? i.webkitGetAsEntry() : null));
  const plain = Array.from(dt.files ?? []);
  if (!entries.some((e) => e?.isDirectory)) return Promise.resolve({ files: plain, folders: [] });

  const fileOf = (e: FileSystemFileEntry) => new Promise<File>((res, rej) => e.file(res, rej));
  const readAll = async (dir: FileSystemDirectoryEntry) => {
    const reader = dir.createReader();
    const out: FileSystemEntry[] = [];
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) return out;
      out.push(...batch);
    }
  };
  const walk = async (dir: FileSystemDirectoryEntry, prefix: string, acc: FolderFile[]) => {
    for (const e of await readAll(dir)) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory) {
        if (SKIP_DIRS.has(e.name)) {
          acc.push({ path: `${path}/…`, file: new File([], "skip") }); // counted as skipped
          continue;
        }
        await walk(e as FileSystemDirectoryEntry, path, acc);
      } else if (acc.length < 2000) acc.push({ path, file: await fileOf(e as FileSystemFileEntry) });
    }
  };
  return (async () => {
    const files: File[] = [];
    const folders: { name: string; entries: FolderFile[] }[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e?.isDirectory) {
        const acc: FolderFile[] = [];
        await walk(e as FileSystemDirectoryEntry, "", acc);
        folders.push({ name: e.name, entries: acc.map((a) => (a.path.endsWith("/…") ? { path: `${a.path.slice(0, -2)}/_/x`, file: a.file } : a)) });
      } else if (e?.isFile) files.push(await fileOf(e as FileSystemFileEntry));
      else if (plain[i]) files.push(plain[i]);
    }
    return { files, folders };
  })();
}

/** Files picked with <input webkitdirectory>: group them by their top folder. */
export function foldersFromInput(list: FileList): { name: string; entries: FolderFile[] }[] {
  const groups = new Map<string, FolderFile[]>();
  for (const f of Array.from(list)) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const [top, ...rest] = rel.split("/");
    const arr = groups.get(top) ?? [];
    arr.push({ path: rest.join("/") || f.name, file: f });
    groups.set(top, arr);
  }
  return [...groups].map(([name, entries]) => ({ name, entries }));
}
