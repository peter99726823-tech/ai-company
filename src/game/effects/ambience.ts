/**
 * Office ambience: windows that show the real sky for the time of day, room lighting that dims at
 * night with desk lamps for whoever is at their desk, a wall clock with the real time, coffee steam.
 * Purely visual — it never affects tasks or movement.
 */
import type Phaser from "phaser";
import { TILE } from "../map/officeMap";

export type Lighting = "auto" | "day" | "night";

export interface Sky {
  phase: "dawn" | "day" | "dusk" | "night";
  top: number;
  bottom: number;
  /** Room light overlay. */
  tint: number;
  tintAlpha: number;
  stars: boolean;
}

/** Sky and room light for a local hour (0–24, fractional). */
export function skyAt(hour: number): Sky {
  if (hour >= 6 && hour < 8) return { phase: "dawn", top: 0x6f8fd6, bottom: 0xf6b48a, tint: 0xffb37a, tintAlpha: 0.06, stars: false };
  if (hour >= 8 && hour < 17) return { phase: "day", top: 0x4f8fe6, bottom: 0xa9d4ff, tint: 0x000000, tintAlpha: 0, stars: false };
  if (hour >= 17 && hour < 19.5) return { phase: "dusk", top: 0x5a4a9c, bottom: 0xf28a5b, tint: 0xff8a50, tintAlpha: 0.1, stars: false };
  return { phase: "night", top: 0x0b1433, bottom: 0x1f2d5c, tint: 0x0a1030, tintAlpha: 0.42, stars: true };
}

export function lightingHour(mode: Lighting, now = new Date()): number {
  if (mode === "day") return 12;
  if (mode === "night") return 22;
  return now.getHours() + now.getMinutes() / 60;
}

export interface WindowRect {
  x: number; // tiles
  y: number;
  w: number;
}

const hash = (n: number) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

export class Ambience {
  private sky: Phaser.GameObjects.Graphics;
  private light: Phaser.GameObjects.Graphics;
  private lamps: Phaser.GameObjects.Graphics;
  private fx: Phaser.GameObjects.Graphics;
  private steamG: Phaser.GameObjects.Graphics;
  mode: Lighting = "auto";

  constructor(
    scene: Phaser.Scene,
    private mapW: number,
    private mapH: number,
    private windows: WindowRect[],
    private clocks: { x: number; y: number }[],
    private steam: { x: number; y: number }[],
  ) {
    this.sky = scene.add.graphics().setDepth(-9); // just above the background, inside the window frames
    this.fx = scene.add.graphics().setDepth(-8);
    this.steamG = scene.add.graphics().setDepth(Math.max(0, ...steam.map((p) => (p.y + 2) * TILE)) + 1); // in front of the machine
    this.light = scene.add.graphics().setDepth(50000); // above people and furniture, below name tags (100000+)
    this.lamps = scene.add.graphics().setDepth(50001).setBlendMode(1); // ADD
  }

  get current(): Sky {
    return skyAt(lightingHour(this.mode));
  }

  /** `lamps`: tile positions of desks whose owner is at the desk. */
  update(t: number, lamps: { x: number; y: number }[]) {
    const now = new Date();
    const hour = lightingHour(this.mode, now);
    const sky = skyAt(hour);
    this.paintWindows(t, sky);
    this.paintFx(t, now);

    const g = this.light;
    g.clear();
    if (sky.tintAlpha > 0) g.fillStyle(sky.tint, sky.tintAlpha).fillRect(0, 0, this.mapW * TILE, this.mapH * TILE);

    const l = this.lamps;
    l.clear();
    if (sky.phase === "night" || sky.phase === "dusk") {
      const k = sky.phase === "night" ? 1 : 0.55;
      for (const p of lamps) {
        const cx = p.x * TILE + TILE / 2,
          cy = p.y * TILE + TILE;
        for (const [r, a] of [
          [34, 0.05],
          [24, 0.06],
          [14, 0.08],
        ] as const)
          l.fillStyle(0xffc070, a * k).fillCircle(cx, cy, r);
      }
      // window light spilling onto the floor at night is cold moonlight
      if (sky.phase === "night")
        for (const w of this.windows) l.fillStyle(0x6a8cff, 0.035).fillRect(w.x * TILE, (w.y + 1) * TILE, w.w * TILE, TILE * 2);
    }
  }

  private paintWindows(t: number, sky: Sky) {
    const g = this.sky;
    g.clear();
    for (const [i, w] of this.windows.entries()) {
      const X = w.x * TILE + 2,
        Y = w.y * TILE + 3,
        W = w.w * TILE - 4,
        H = 11;
      // two-band gradient
      g.fillStyle(sky.top, 1).fillRect(X, Y, W, H);
      g.fillStyle(sky.bottom, 1).fillRect(X, Y + 6, W, H - 6);
      g.fillStyle(sky.bottom, 0.5).fillRect(X, Y + 4, W, 2);
      if (sky.stars) {
        for (let s = 0; s < W / 5; s++) {
          const sx = X + Math.floor(hash(i * 31 + s) * W),
            sy = Y + Math.floor(hash(i * 17 + s * 3) * 6);
          const tw = (Math.sin(t * 2 + s * 1.7 + i) + 1) / 2;
          g.fillStyle(0xffffff, 0.35 + tw * 0.6).fillRect(sx, sy, 1, 1);
        }
        if (i % 3 === 0) {
          g.fillStyle(0xf4f1d0, 1).fillCircle(X + W - 7, Y + 3.5, 2.5);
          g.fillStyle(sky.top, 1).fillCircle(X + W - 6, Y + 2.7, 2.2); // crescent
        }
        // city lights on the horizon
        for (let s = 0; s < W; s += 3) if (hash(i * 7 + s) > 0.45) g.fillStyle(0xffd27a, 0.8).fillRect(X + s, Y + H - 2, 1, 1);
      } else {
        // drifting clouds
        const span = W + 24;
        for (let c = 0; c < 2; c++) {
          const cx = X - 12 + ((t * (3 + c * 2) + hash(i + c * 9) * span) % span),
            cy = Y + 2 + c * 3;
          const col = sky.phase === "day" ? 0xffffff : 0xffd9c0;
          g.fillStyle(col, 0.85).fillRect(cx, cy, 8, 2);
          g.fillStyle(col, 0.85).fillRect(cx + 2, cy - 1, 4, 1);
        }
        if (sky.phase !== "day" && i % 3 === 0) g.fillStyle(0xffe08a, 1).fillCircle(X + 6, Y + H - 2, 2.5); // low sun
      }
      // clip clouds/sun that drifted past the frame, then the frame and mullion
      g.fillStyle(0x39405a, 1).fillRect(X - 14, Y - 1, 14, H + 2).fillRect(X + W, Y - 1, 14, H + 2);
      g.fillStyle(0x7d869d, 1).fillRect(X + Math.floor(W / 2), Y, 1, H);
      g.fillStyle(0x7d869d, 1).fillRect(X, Y + H, W, 1);
      g.lineStyle(1, 0x1a1e2c, 1).strokeRect(X - 0.5, Y - 0.5, W + 1, H + 1);
    }
  }

  private paintFx(t: number, now: Date) {
    const g = this.fx;
    g.clear();
    // wall clocks: real local time
    for (const c of this.clocks) {
      const cx = c.x * TILE + TILE / 2,
        cy = c.y * TILE + 8,
        r = 6;
      g.fillStyle(0x1a1e2c, 1).fillCircle(cx, cy, r + 1);
      g.fillStyle(0xf1eee4, 1).fillCircle(cx, cy, r);
      for (let k = 0; k < 12; k += 3) {
        const a = (k / 12) * Math.PI * 2;
        g.fillStyle(0x3b4152, 1).fillRect(cx + Math.sin(a) * (r - 1.5) - 0.5, cy - Math.cos(a) * (r - 1.5) - 0.5, 1, 1);
      }
      const h = ((now.getHours() % 12) + now.getMinutes() / 60) / 12,
        m = now.getMinutes() / 60;
      g.lineStyle(1.5, 0x1a1e2c, 1).lineBetween(cx, cy, cx + Math.sin(h * Math.PI * 2) * 3, cy - Math.cos(h * Math.PI * 2) * 3);
      g.lineStyle(1, 0x3b4152, 1).lineBetween(cx, cy, cx + Math.sin(m * Math.PI * 2) * 4.8, cy - Math.cos(m * Math.PI * 2) * 4.8);
      g.fillStyle(0xe53935, 1).fillRect(cx - 0.5, cy - 0.5, 1, 1);
    }
    // coffee steam rising from the machine
    const sg = this.steamG;
    sg.clear();
    for (const s of this.steam) {
      for (let p = 0; p < 3; p++) {
        const life = (t * 0.6 + p / 3) % 1;
        const x = s.x * TILE + 6 + Math.sin(life * 6 + p) * 2,
          y = s.y * TILE - 2 - life * 14;
        sg.fillStyle(0xffffff, 0.35 * (1 - life)).fillCircle(x, y, 1.5 + life * 1.5);
      }
    }
  }
}
