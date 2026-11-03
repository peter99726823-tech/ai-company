"use client";
import { marked } from "marked";
import DOMPurify from "dompurify";

/**
 * Markdown → safe HTML for reports, meetings and chat.
 * Korean ranges ("1~2일", "5~10명") use a single tilde, which GFM would read as strikethrough;
 * a lone tilde is escaped so only an explicit ~~double~~ strikes text through.
 */
export function md(text: string): string {
  const src = text.replace(/(?<!~)~(?!~)/g, "\\~");
  return DOMPurify.sanitize(marked.parse(src, { async: false }) as string);
}
