import { gt, asc, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-Sent Events: streams task_events rows in id order.
 * The worker writes events into SQLite from another process, so this route polls the table
 * (every 500 ms) rather than an in-memory bus. Reconnecting clients resume from Last-Event-ID.
 */
export async function GET(req: Request) {
  const db = getDb();
  const url = new URL(req.url);
  const header = req.headers.get("last-event-id");
  const fromParam = url.searchParams.get("after");
  let last =
    Number(header ?? fromParam ?? NaN) ||
    db.select({ m: sql<number>`coalesce(max(${s.taskEvents.id}),0)` }).from(s.taskEvents).get()!.m;

  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let ping: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        clearInterval(timer);
        clearInterval(ping);
      };
      send(`retry: 2000\n: connected ${last}\n\n`);
      timer = setInterval(() => {
        const rows = db.select().from(s.taskEvents).where(gt(s.taskEvents.id, last)).orderBy(asc(s.taskEvents.id)).limit(200).all();
        for (const r of rows) {
          last = r.id;
          send(`id: ${r.id}\nevent: task\ndata: ${JSON.stringify(r)}\n\n`);
        }
      }, 500);
      ping = setInterval(() => send(`: ping\n\n`), 15000);
      req.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      clearInterval(timer);
      clearInterval(ping);
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
