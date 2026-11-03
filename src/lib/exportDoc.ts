"use client";
/**
 * Export a report or meeting as a file the CEO can hand in or keep editing:
 * Markdown (.md) or Word (.docx). Inside claude.ai the save goes through the downloads capability
 * (the viewer confirms); elsewhere it is a normal browser download.
 */

type SaveFn = (r: { filename: string; data: string | Blob }) => Promise<unknown>;

export async function saveFile(filename: string, data: string | Blob, mime = "text/plain") {
  const c = (window as unknown as { claude?: { use(n: string): Promise<{ save: SaveFn } | null> } }).claude;
  const dl = c ? await c.use("downloads").catch(() => null) : null;
  if (dl) return dl.save({ filename, data });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(typeof data === "string" ? new Blob([data], { type: mime }) : data);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** A safe file name from a title, with today's date. */
export function fileBase(title: string) {
  const clean = title.replace(/[\\/:*?"<>|#\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "문서";
  return `${clean} ${new Date().toISOString().slice(0, 10)}`;
}

// ─── Markdown → Word ────────────────────────────────────────────────

type Run = { text: string; bold?: boolean; italics?: boolean };
function inlineRuns(s: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    const t = m[0];
    if (t.startsWith("**")) out.push({ text: t.slice(2, -2), bold: true });
    else if (t.startsWith("`")) out.push({ text: t.slice(1, -1) });
    else out.push({ text: t.slice(1, -1), italics: true });
    last = m.index + t.length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.map((r) => ({ ...r, text: r.text.replace(/\\~/g, "~") }));
}

/** Convert the Markdown our reports use (headings, lists, tables, bold) into a .docx Blob. */
export async function markdownToDocx(markdown: string, title: string): Promise<Blob> {
  const d = await import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } = d;
  const runs = (s: string, extra: Partial<Run> = {}) => inlineRuns(s).map((r) => new TextRun({ ...r, ...extra, font: "Malgun Gothic" }));
  const children: (InstanceType<typeof Paragraph> | InstanceType<typeof Table>)[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const H = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) continue;
    // table: consecutive lines starting with |
    if (t.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const cols = Math.max(...rows.map((r) => r.length));
      const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: rows.map(
            (r, ri) =>
              new TableRow({
                children: Array.from({ length: cols }, (_, ci) => new TableCell({ borders: { top: border, bottom: border, left: border, right: border }, children: [new Paragraph({ children: runs(r[ci] ?? "", ri === 0 ? { bold: true } : {}) })] })),
              }),
          ),
        }),
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(t);
    if (h) {
      children.push(new Paragraph({ heading: H[h[1].length - 1], children: runs(h[2]) }));
      continue;
    }
    const b = /^[-*]\s+(.*)$/.exec(t);
    if (b) {
      const level = Math.min(2, Math.floor((line.length - line.trimStart().length) / 2));
      children.push(new Paragraph({ bullet: { level }, children: runs(b[1].replace(/^\[ \]\s*/, "☐ ").replace(/^\[x\]\s*/i, "☑ ")) }));
      continue;
    }
    const n = /^(\d+)[.)]\s+(.*)$/.exec(t);
    if (n) {
      children.push(new Paragraph({ children: runs(`${n[1]}. ${n[2]}`), indent: { left: 360 } }));
      continue;
    }
    if (/^(---|===)/.test(t)) continue;
    const q = /^>\s?(.*)$/.exec(t);
    if (q) {
      if (q[1]) children.push(new Paragraph({ children: runs(q[1], { italics: true }), indent: { left: 360 } }));
      continue;
    }
    children.push(new Paragraph({ children: runs(t), spacing: { after: 120 } }));
  }
  const doc = new Document({
    creator: "나의 AI 회사",
    title,
    styles: { default: { document: { run: { font: "Malgun Gothic", size: 21 } } } },
    sections: [{ children }],
  });
  return Packer.toBlob(doc);
}
