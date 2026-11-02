import { createRoot } from "react-dom/client";
import { openStore } from "./storage";
import { initDb, exportDb } from "./client";
import { installRouter, onChange, notifyChange } from "./router";
import { getDb } from "./client";
import { runScheduler } from "../src/server/autonomy/service";
import { saveState } from "./save";
import { App } from "./App";

const root = createRoot(document.getElementById("root")!);

(async () => {
  try {
    const store = await openStore();
    const saved = await store.load();
    await initDb(saved);
    installRouter();

    // Save after every change (debounced), and right away when the page is hidden.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let chain = Promise.resolve();
    const flush = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      saveState.set({ status: "saving" });
      chain = chain.then(async () => {
        try {
          await store.save(exportDb());
          saveState.set({ status: "idle", at: Date.now(), error: undefined });
        } catch (e) {
          saveState.set({ status: "error", error: (e as Error).message ?? String(e) });
        }
      });
    };
    onChange(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 800);
    });
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && timer && flush());
    if (!saved) flush(); // first visit: store the seeded company right away

    // Recurring work: the link version has no server, so routines are checked while this page is open.
    const schedule = () => {
      try {
        if (runScheduler(getDb() as never, Date.now(), false).length) notifyChange();
      } catch (e) {
        console.warn("scheduler", e);
      }
    };
    schedule();
    setInterval(schedule, 30000);

    root.render(<App storeKind={store.kind} />);
  } catch (e) {
    root.render(
      <div style={{ padding: 24, color: "#ff6b6b", fontFamily: "sans-serif" }}>
        기록을 여는 중 문제가 생겼습니다: {(e as Error).message}
      </div>,
    );
  }
})();
