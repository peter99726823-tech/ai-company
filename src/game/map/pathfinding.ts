/**
 * A* on the office grid (4-directional). Returns the tile path from start to goal,
 * excluding the start tile and including the goal, or null when unreachable.
 */
import { MAP_W, MAP_H, isWalkable, type Grid } from "./officeMap";

export interface Pt {
  x: number;
  y: number;
}

class MinHeap {
  private a: { k: number; f: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, f: number) {
    const a = this.a;
    a.push({ k, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0].k;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1,
          r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function findPath(grid: Grid, start: Pt, goal: Pt): Pt[] | null {
  if (!isWalkable(grid, goal.x, goal.y)) return null;
  if (start.x === goal.x && start.y === goal.y) return [];
  const N = MAP_W * MAP_H;
  const g = new Float64Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const key = (x: number, y: number) => y * MAP_W + x;
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  const s = key(start.x, start.y);
  const goalK = key(goal.x, goal.y);
  g[s] = 0;
  const open = new MinHeap();
  open.push(s, h(start.x, start.y));
  while (open.size) {
    const cur = open.pop();
    if (cur === goalK) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % MAP_W,
      cy = (cur / MAP_W) | 0;
    const prev = came[cur];
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx,
        ny = cy + dy;
      if (!isWalkable(grid, nx, ny)) continue;
      const nk = key(nx, ny);
      if (closed[nk]) continue;
      // Small penalty for turning keeps paths in straight runs (looks more natural).
      let turn = 0;
      if (prev >= 0) {
        const px = prev % MAP_W,
          py = (prev / MAP_W) | 0;
        if (cx - px !== dx || cy - py !== dy) turn = 0.01;
      }
      const ng = g[cur] + 1 + turn;
      if (ng < g[nk]) {
        g[nk] = ng;
        came[nk] = cur;
        open.push(nk, ng + h(nx, ny));
      }
    }
  }
  if (came[goalK] === -1) return null;
  const out: Pt[] = [];
  for (let k = goalK; k !== s; k = came[k]) out.push({ x: k % MAP_W, y: (k / MAP_W) | 0 });
  return out.reverse();
}

/** Collapse a tile path into its corner points so movement tweens run in straight segments. */
export function corners(path: Pt[], start: Pt): Pt[] {
  if (path.length < 2) return path.slice();
  const out: Pt[] = [];
  let prev = start;
  for (let i = 0; i < path.length; i++) {
    const cur = path[i];
    const next = path[i + 1];
    if (!next) {
      out.push(cur);
      break;
    }
    const d1x = cur.x - prev.x,
      d1y = cur.y - prev.y;
    const d2x = next.x - cur.x,
      d2y = next.y - cur.y;
    if (d1x !== d2x || d1y !== d2y) out.push(cur);
    prev = cur;
  }
  return out;
}
