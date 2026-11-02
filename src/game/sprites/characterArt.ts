/**
 * Original pixel-art characters, drawn procedurally at 16×24 px per frame.
 * No external assets: every employee gets a spritesheet built from their EmployeeLook.
 *
 * Frame map (index → pose). Keep in sync with ANIMS below.
 *  0-3  walk down      4-7  walk up       8-11 walk side (faces left; flipX for right)
 * 12-13 idle down     14-15 working       16-17 thinking     18-19 meeting (front)
 * 20-21 reporting     22-23 resting       24-25 error        26-27 waiting
 * 28    idle up       29    idle side     30    meeting up   31    meeting side
 */
import type { EmployeeLook } from "@/domain/types";

export const FW = 16;
export const FH = 24;
export const FRAME_COUNT = 32;

type View = "down" | "up" | "side";
type Arms = "down" | "swingA" | "swingB" | "type1" | "type2" | "chin" | "gesture" | "paper" | "paperUp" | "cup" | "head" | "cross";

interface Pose {
  view: View;
  leg: -1 | 0 | 1;
  bob: 0 | 1;
  arms: Arms;
  eyes: "open" | "closed" | "up" | "down";
  mouth: "none" | "smile" | "open";
  shake: -1 | 0 | 1;
  tap: boolean;
}

const P = (p: Partial<Pose>): Pose => ({ view: "down", leg: 0, bob: 0, arms: "down", eyes: "open", mouth: "none", shake: 0, tap: false, ...p });

export const POSES: Pose[] = [
  // walk down
  P({ leg: 0, arms: "down" }),
  P({ leg: 1, bob: 1, arms: "swingA" }),
  P({ leg: 0, arms: "down" }),
  P({ leg: -1, bob: 1, arms: "swingB" }),
  // walk up
  P({ view: "up", leg: 0 }),
  P({ view: "up", leg: 1, bob: 1, arms: "swingA" }),
  P({ view: "up", leg: 0 }),
  P({ view: "up", leg: -1, bob: 1, arms: "swingB" }),
  // walk side
  P({ view: "side", leg: 0 }),
  P({ view: "side", leg: 1, bob: 1, arms: "swingA" }),
  P({ view: "side", leg: 0 }),
  P({ view: "side", leg: -1, bob: 1, arms: "swingB" }),
  // idle down
  P({ mouth: "smile" }),
  P({ bob: 1, eyes: "closed", mouth: "smile" }),
  // working
  P({ arms: "type1", eyes: "down" }),
  P({ arms: "type2", eyes: "down", bob: 1 }),
  // thinking
  P({ arms: "chin", eyes: "up" }),
  P({ arms: "chin", eyes: "up", bob: 1 }),
  // meeting (front)
  P({ arms: "gesture", mouth: "open" }),
  P({ arms: "down", mouth: "smile", bob: 1 }),
  // reporting
  P({ arms: "paper", mouth: "smile" }),
  P({ arms: "paperUp", mouth: "open" }),
  // resting
  P({ arms: "cup", eyes: "closed", mouth: "smile" }),
  P({ arms: "cup", mouth: "smile", bob: 1 }),
  // error
  P({ arms: "head", mouth: "open", shake: -1 }),
  P({ arms: "head", mouth: "open", shake: 1 }),
  // waiting
  P({ arms: "cross" }),
  P({ arms: "cross", tap: true, eyes: "closed" }),
  // idle up / idle side
  P({ view: "up" }),
  P({ view: "side" }),
  // meeting up / meeting side
  P({ view: "up", bob: 1 }),
  P({ view: "side", bob: 1, mouth: "open" }),
];

export const ANIMS: Record<string, { frames: number[]; rate: number; repeat?: number }> = {
  "walk-down": { frames: [0, 1, 2, 3], rate: 8 },
  "walk-up": { frames: [4, 5, 6, 7], rate: 8 },
  "walk-side": { frames: [8, 9, 10, 11], rate: 8 },
  "idle-down": { frames: [12, 12, 12, 12, 12, 13], rate: 3 },
  "idle-up": { frames: [28], rate: 1 },
  "idle-side": { frames: [29], rate: 1 },
  working: { frames: [14, 15], rate: 6 },
  thinking: { frames: [16, 16, 17], rate: 2 },
  "meeting-down": { frames: [18, 19, 19], rate: 3 },
  "meeting-up": { frames: [28, 30], rate: 2 },
  "meeting-side": { frames: [29, 31], rate: 3 },
  reporting: { frames: [20, 21], rate: 3 },
  resting: { frames: [22, 22, 23], rate: 1.5 },
  error: { frames: [24, 25], rate: 10 },
  waiting: { frames: [26, 26, 27], rate: 3 },
};

// ─── color helpers ────────────────────────────────────────────────

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function shade(h: string, amt: number): string {
  const [r, g, b] = hexToRgb(h);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
  return `#${[f(r), f(g), f(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

const INK = "#1b1b26";
const SHOE = "#22232c";

// ─── drawing ──────────────────────────────────────────────────────

type Ctx = CanvasRenderingContext2D;

export function drawFrame(ctx: Ctx, ox: number, oy: number, look: EmployeeLook, pose: Pose) {
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(ox + x + pose.shake, oy + y, w, h);
  };
  const b = pose.bob;
  const skinD = shade(look.skin, -0.15);
  const shirtD = shade(look.shirt, -0.25);
  const shirtL = shade(look.shirt, 0.15);
  const pantsD = shade(look.pants, -0.2);

  if (pose.view === "side") return drawSide(px, look, pose);

  // legs + shoes (do not bob)
  const legRows = (lift: number) => ({ top: 18, h: 4 - lift, shoe: 22 - lift });
  const L = legRows(pose.leg === 1 ? 1 : 0);
  const R = legRows(pose.leg === -1 ? 1 : 0);
  px(5, L.top, 2, L.h, look.pants);
  px(9, R.top, 2, R.h, look.pants);
  px(5, L.shoe, 2, 2, SHOE);
  px(9, R.shoe - (pose.tap ? 1 : 0), 2, 2, SHOE);

  // torso
  px(4, 11 + b, 8, 7, look.shirt);
  px(4, 17 + b, 8, 1, pantsD);
  px(4, 11 + b, 1, 6, shirtD);
  if (pose.view === "down") px(6, 11 + b, 4, 1, shirtL); // collar

  // arms
  drawArms(px, look, pose, b, shirtD);

  // neck + head
  px(7, 10 + b, 2, 1, skinD);
  px(4, 3 + b, 8, 7, look.skin);
  px(4, 3 + b, 1, 1, "transparent");
  ctx.clearRect(ox + 4 + pose.shake, oy + 3 + b, 1, 1);
  ctx.clearRect(ox + 11 + pose.shake, oy + 3 + b, 1, 1);
  ctx.clearRect(ox + 4 + pose.shake, oy + 9 + b, 1, 1);
  ctx.clearRect(ox + 11 + pose.shake, oy + 9 + b, 1, 1);

  if (pose.view === "down") {
    // ears
    px(3, 6 + b, 1, 2, skinD);
    px(12, 6 + b, 1, 2, skinD);
    // eyes
    const ey = pose.eyes === "up" ? 5 : pose.eyes === "down" ? 7 : 6;
    if (pose.eyes === "closed") {
      px(5, 7 + b, 2, 1, INK);
      px(9, 7 + b, 2, 1, INK);
    } else {
      px(6, ey + b, 1, 2, INK);
      px(9, ey + b, 1, 2, INK);
    }
    // cheeks
    px(5, 8 + b, 1, 1, shade(look.skin, -0.06));
    px(10, 8 + b, 1, 1, shade(look.skin, -0.06));
    if (pose.mouth === "smile") px(7, 8 + b, 2, 1, shade(look.skin, -0.3));
    if (pose.mouth === "open") px(7, 8 + b, 2, 2, "#8e3b3b");
  }

  drawHair(px, look, pose.view, b);
  drawAccessory(px, look, pose.view, b, pose);
}

type PX = (x: number, y: number, w: number, h: number, c: string) => void;

function drawArms(px: PX, look: EmployeeLook, pose: Pose, b: number, shirtD: string) {
  const s = look.shirt;
  const k = look.skin;
  switch (pose.arms) {
    case "down":
    case "swingA":
    case "swingB": {
      const la = pose.arms === "swingA" ? 1 : 0;
      const ra = pose.arms === "swingB" ? 1 : 0;
      px(3, 12 + b + la, 1, 5, s);
      px(12, 12 + b + ra, 1, 5, shirtD);
      px(3, 17 + b + la, 1, 1, k);
      px(12, 17 + b + ra, 1, 1, k);
      break;
    }
    case "type1":
    case "type2": {
      const o = pose.arms === "type1" ? 0 : 1;
      px(3, 12 + b, 1, 3, s);
      px(12, 12 + b, 1, 3, shirtD);
      px(4, 15 + b + o, 2, 1, k);
      px(10, 15 + b + (1 - o), 2, 1, k);
      break;
    }
    case "chin":
      px(3, 12 + b, 1, 5, s);
      px(3, 17 + b, 1, 1, k);
      px(12, 11 + b, 1, 3, shirtD);
      px(11, 10 + b, 1, 2, s);
      px(10, 9 + b, 2, 1, k);
      break;
    case "gesture":
      px(3, 12 + b, 1, 5, s);
      px(3, 17 + b, 1, 1, k);
      px(12, 8 + b, 1, 5, shirtD);
      px(12, 7 + b, 1, 1, k);
      break;
    case "paper":
    case "paperUp": {
      const u = pose.arms === "paperUp" ? -1 : 0;
      px(3, 12 + b, 1, 3, s);
      px(12, 12 + b, 1, 3, shirtD);
      px(5, 12 + b + u, 6, 5, "#f4f1e8");
      px(6, 13 + b + u, 4, 1, "#9aa3b8");
      px(6, 15 + b + u, 3, 1, "#9aa3b8");
      px(4, 14 + b + u, 1, 1, k);
      px(11, 14 + b + u, 1, 1, k);
      break;
    }
    case "cup":
      px(3, 12 + b, 1, 5, s);
      px(3, 17 + b, 1, 1, k);
      px(12, 12 + b, 1, 3, shirtD);
      px(11, 13 + b, 2, 3, "#f4f1e8");
      px(11, 13 + b, 2, 1, "#6b4a33");
      px(13, 14 + b, 1, 1, "#f4f1e8");
      break;
    case "head":
      px(3, 5 + b, 1, 7, s);
      px(12, 5 + b, 1, 7, shirtD);
      px(4, 3 + b, 1, 2, k);
      px(11, 3 + b, 1, 2, k);
      break;
    case "cross":
      px(3, 12 + b, 1, 3, s);
      px(12, 12 + b, 1, 3, shirtD);
      px(4, 13 + b, 8, 2, shirtD);
      px(4, 14 + b, 1, 1, k);
      px(11, 13 + b, 1, 1, k);
      break;
  }
}

function drawHair(px: PX, look: EmployeeLook, view: View, b: number) {
  const h = look.hair;
  const hl = shade(h, 0.25);
  const st = look.hairStyle;
  if (view === "up") {
    // back of head
    px(4, 2 + b, 8, 7, h);
    px(5, 1 + b, 6, 1, h);
    if (st === "long" || st === "bob") px(3, 4 + b, 10, st === "long" ? 9 : 6, h);
    if (st === "ponytail") px(7, 9 + b, 2, 4, h);
    if (st === "bun") px(6, 0 + b, 4, 2, h);
    if (st === "spiky") [5, 7, 9].forEach((x) => px(x, 0 + b, 1, 1, h));
    if (st === "curly") px(3, 2 + b, 10, 6, h);
    if (st === "buzz") {
      px(4, 2 + b, 8, 7, shade(look.skin, -0.05));
      px(4, 2 + b, 8, 3, h);
    }
    px(6, 2 + b, 2, 1, hl);
    return;
  }
  // front: top cap common to most styles
  const cap = () => {
    px(5, 1 + b, 6, 1, h);
    px(4, 2 + b, 8, 2, h);
  };
  switch (st) {
    case "short":
      cap();
      px(4, 4 + b, 1, 2, h);
      px(11, 4 + b, 1, 2, h);
      px(5, 4 + b, 3, 1, h);
      break;
    case "sidePart":
      cap();
      px(4, 4 + b, 5, 1, h);
      px(4, 5 + b, 2, 1, h);
      px(11, 4 + b, 1, 2, h);
      px(9, 2 + b, 1, 1, hl);
      break;
    case "long":
      cap();
      px(3, 3 + b, 2, 10, h);
      px(11, 3 + b, 2, 10, h);
      px(5, 4 + b, 6, 1, h);
      break;
    case "ponytail":
      cap();
      px(4, 4 + b, 1, 2, h);
      px(11, 4 + b, 1, 2, h);
      px(5, 4 + b, 2, 1, h);
      px(12, 3 + b, 1, 4, h);
      break;
    case "spiky":
      cap();
      [4, 6, 8, 10].forEach((x) => px(x, 0 + b, 1, 1, h));
      [5, 7, 9].forEach((x) => px(x, 4 + b, 1, 1, h));
      px(4, 4 + b, 1, 1, h);
      px(11, 4 + b, 1, 1, h);
      break;
    case "bob":
      cap();
      px(3, 3 + b, 2, 7, h);
      px(11, 3 + b, 2, 7, h);
      px(5, 4 + b, 6, 1, h);
      break;
    case "bun":
      cap();
      px(6, -1 + b + 1, 4, 1, h);
      px(7, 0 + b, 2, 1, hl);
      px(4, 4 + b, 1, 2, h);
      px(11, 4 + b, 1, 2, h);
      break;
    case "curly":
      px(4, 1 + b, 8, 3, h);
      [3, 12].forEach((x) => px(x, 2 + b, 1, 5, h));
      [4, 6, 8, 10].forEach((x) => px(x, 0 + b, 2, 1, h));
      [5, 7, 9].forEach((x) => px(x, 4 + b, 1, 1, h));
      [5, 9].forEach((x) => px(x, 2 + b, 1, 1, hl));
      break;
    case "buzz":
      px(4, 2 + b, 8, 2, h);
      px(5, 1 + b, 6, 1, shade(h, 0.1));
      break;
  }
  if (st !== "curly" && st !== "buzz") px(6, 2 + b, 2, 1, hl);
}

function drawAccessory(px: PX, look: EmployeeLook, view: View, b: number, pose: Pose) {
  const a = look.accent;
  switch (look.accessory) {
    case "tie":
      if (view === "down" && pose.arms !== "paper" && pose.arms !== "paperUp" && pose.arms !== "cross") {
        px(7, 11 + b, 2, 1, "#9b2c2c");
        px(7, 12 + b, 2, 4, "#c0392b");
        px(7, 16 + b, 2, 1, "#9b2c2c");
      }
      break;
    case "glasses":
      if (view === "down") {
        px(5, 5 + b, 3, 1, INK);
        px(8, 5 + b, 3, 1, INK);
        px(5, 6 + b, 1, 2, INK);
        px(10, 6 + b, 1, 2, INK);
        px(7, 6 + b, 2, 1, INK);
      }
      break;
    case "headset":
      px(4, 1 + b, 8, 1, "#3a3d4a");
      px(3, 5 + b, 1, 3, "#3a3d4a");
      px(12, 5 + b, 1, 3, "#3a3d4a");
      if (view === "down") px(11, 8 + b, 2, 1, "#3a3d4a");
      break;
    case "beret":
      px(3, 1 + b, 8, 2, a);
      px(4, 0 + b, 6, 1, a);
      px(7, -1 + b + 1, 1, 1, shade(a, -0.3));
      break;
    case "visor":
      if (view !== "up") {
        px(3, 3 + b, 10, 1, "#43a047");
        if (view === "down") px(4, 4 + b, 8, 1, "#66bb6a");
      } else px(3, 3 + b, 10, 1, "#43a047");
      break;
    case "bowtie":
      if (view === "down") {
        px(6, 11 + b, 1, 2, "#1d3557");
        px(9, 11 + b, 1, 2, "#1d3557");
        px(7, 11 + b, 2, 1, "#457b9d");
      }
      break;
    case "cap":
      px(4, 0 + b, 8, 3, a);
      px(5, 0 + b, 2, 1, shade(a, 0.3));
      if (view === "down") px(3, 3 + b, 7, 1, shade(a, -0.3));
      break;
    default:
      break;
  }
}

function drawSide(px: PX, look: EmployeeLook, pose: Pose) {
  const b = pose.bob;
  const h = look.hair;
  const shirtD = shade(look.shirt, -0.25);
  // legs: front leg offset by swing
  const f = pose.leg === 1 ? -1 : pose.leg === -1 ? 1 : 0;
  px(7 + f, 18, 2, 4, look.pants);
  px(7 - f, 18, 2, 4, shade(look.pants, -0.2));
  px(6 + f, 22, 3, 2, SHOE);
  if (f !== 0) px(6 - f, 22, 3, 2, SHOE);
  // torso
  px(5, 11 + b, 6, 7, look.shirt);
  px(5, 17 + b, 6, 1, shade(look.pants, -0.2));
  // arm (swings opposite to front leg)
  const a = pose.arms === "swingA" ? 1 : pose.arms === "swingB" ? -1 : 0;
  px(7 + a, 12 + b, 2, 5, shirtD);
  px(7 + a, 17 + b, 2, 1, look.skin);
  // head
  px(5, 3 + b, 7, 7, look.skin);
  px(4, 6 + b, 1, 2, look.skin); // nose
  px(7, 10 + b, 2, 1, shade(look.skin, -0.15));
  if (pose.eyes === "closed") px(5, 7 + b, 2, 1, INK);
  else px(6, 6 + b, 1, 2, INK);
  if (pose.mouth === "open") px(5, 8 + b, 1, 1, "#8e3b3b");
  // hair (back of head on the right side)
  px(5, 1 + b, 6, 1, h);
  px(5, 2 + b, 7, 2, h);
  px(9, 3 + b, 3, 4, h);
  if (look.hairStyle === "long" || look.hairStyle === "bob") px(9, 3 + b, 3, look.hairStyle === "long" ? 10 : 7, h);
  if (look.hairStyle === "ponytail") px(12, 4 + b, 2, 5, h);
  if (look.hairStyle === "bun") px(10, 0 + b, 3, 2, h);
  if (look.hairStyle === "spiky") [5, 7, 9].forEach((x) => px(x, 0 + b, 1, 1, h));
  if (look.hairStyle === "curly") px(4, 1 + b, 8, 3, h);
  if (look.hairStyle === "buzz") {
    px(5, 1 + b, 6, 1, look.skin);
    px(5, 2 + b, 7, 1, h);
  }
  px(8, 7 + b, 1, 1, shade(look.skin, -0.15)); // ear
  switch (look.accessory) {
    case "cap":
      px(4, 0 + b, 8, 3, look.accent);
      px(2, 3 + b, 4, 1, shade(look.accent, -0.3));
      break;
    case "beret":
      px(5, 0 + b, 7, 2, look.accent);
      break;
    case "headset":
      px(5, 1 + b, 6, 1, "#3a3d4a");
      px(8, 5 + b, 2, 3, "#3a3d4a");
      px(5, 9 + b, 3, 1, "#3a3d4a");
      break;
    case "glasses":
      px(4, 6 + b, 4, 1, INK);
      break;
    case "visor":
      px(2, 3 + b, 9, 1, "#43a047");
      break;
    case "tie":
      px(5, 12 + b, 1, 4, "#c0392b");
      break;
    default:
      break;
  }
}

/** Build a full spritesheet canvas (FRAME_COUNT frames in one row). */
export function buildSheet(look: EmployeeLook): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = FW * FRAME_COUNT;
  c.height = FH;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  POSES.forEach((pose, i) => drawFrame(ctx, i * FW, 0, look, pose));
  return c;
}

/** A single still portrait (idle-down frame), scaled up for UI use. */
export function portraitDataUrl(look: EmployeeLook, scale = 5): string {
  const c = document.createElement("canvas");
  c.width = FW * scale;
  c.height = FH * scale;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const src = document.createElement("canvas");
  src.width = FW;
  src.height = FH;
  drawFrame(src.getContext("2d")!, 0, 0, look, POSES[12]);
  ctx.drawImage(src, 0, 0, FW * scale, FH * scale);
  return c.toDataURL();
}
