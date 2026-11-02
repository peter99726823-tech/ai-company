// Save status shared between the saver and the banner.
export interface SaveState {
  status: "idle" | "saving" | "error";
  at: number | null;
  error?: string;
}
let state: SaveState = { status: "idle", at: null };
const subs = new Set<(s: SaveState) => void>();
export const saveState = {
  get: () => state,
  set(next: Partial<SaveState>) {
    state = { ...state, ...next };
    subs.forEach((f) => f(state));
  },
  subscribe(f: (s: SaveState) => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
