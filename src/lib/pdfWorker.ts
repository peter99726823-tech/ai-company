// PC (Next.js) version: let the bundler serve pdf.js's worker as its own file.
export function createPdfWorker(): Worker {
  return new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
}
