// Link version: the page is one file, so the worker code is embedded and started from a blob: URL.
import workerSource from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?text";

export function createPdfWorker(): Worker {
  const url = URL.createObjectURL(new Blob([workerSource as unknown as string], { type: "text/javascript" }));
  return new Worker(url, { type: "module" });
}
