/**
 * Procedural pixel art for the office: background (floors, walls, wall decor, room plates)
 * and individual furniture pieces. Furniture is drawn as separate images so characters
 * can walk behind or in front of it (depth sorting by y).
 */
import {
  TILE,
  MAP_W,
  MAP_H,
  ROOMS,
  CORRIDOR,
  DOORS,
  DECOR,
  type Furniture,
  type Decor,
  type Grid,
  Cell,
} from "../map/officeMap";
import { shade } from "./characterArt";

export const UI_FONT = '"Galmuri11", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

const C = {
  void: "#0b0d15",
  hall: ["#1c2030", "#1f2335"] as const,
  wallFace: "#39405a",
  wallFaceD: "#2c3248",
  wallTop: "#545e82",
  wallLine: "#1a1e2c",
  wood: "#8a5a3b",
  woodL: "#a8714c",
  woodD: "#5e3c27",
  metal: "#5b6378",
  metalL: "#7d869d",
  metalD: "#3b4152",
  screenOff: "#141824",
  paper: "#f1eee4",
  plant: "#3fa36b",
  plantD: "#2b7a4b",
  pot: "#b5653e",
};

type Ctx = CanvasRenderingContext2D;
const rect = (ctx: Ctx, x: number, y: number, w: number, h: number, c: string) => {
  ctx.fillStyle = c;
  ctx.fillRect(x, y, w, h);
};

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

// ─── background ───────────────────────────────────────────────────

export function buildBackground(grid: Grid): HTMLCanvasElement {
  const [c, ctx] = canvas(MAP_W * TILE, MAP_H * TILE);
  rect(ctx, 0, 0, c.width, c.height, C.void);

  // corridor
  for (let y = CORRIDOR.y0; y <= CORRIDOR.y1; y++)
    for (let x = CORRIDOR.x0; x <= CORRIDOR.x1; x++) rect(ctx, x * TILE, y * TILE, TILE, TILE, C.hall[(x + y) % 2]);
  // hallway runner stripe
  rect(ctx, CORRIDOR.x0 * TILE, 17.5 * TILE, (CORRIDOR.x1 - CORRIDOR.x0 + 1) * TILE, 2, "#262b40");

  // room floors (checker + subtle plank lines)
  for (const r of ROOMS) {
    for (let y = r.y0; y <= r.y1; y++)
      for (let x = r.x0; x <= r.x1; x++) {
        rect(ctx, x * TILE, y * TILE, TILE, TILE, r.floor[(x + y) % 2]);
        rect(ctx, x * TILE, y * TILE + TILE - 1, TILE, 1, shade(r.floor[0], -0.12));
      }
    // accent strip along the bottom edge of the room
    rect(ctx, r.x0 * TILE, (r.y1 + 1) * TILE - 2, (r.x1 - r.x0 + 1) * TILE, 2, shade(r.accent, -0.45));
  }

  // doors (floor already carved); draw door mats
  for (const d of DOORS) rect(ctx, d.x * TILE + 1, d.y * TILE + 3, TILE - 2, TILE - 6, "#2a2f45");

  // walls: 3/4 view. A wall cell shows a lighter top edge and a darker front face if the cell below is floor.
  for (let y = 0; y < MAP_H; y++)
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y * MAP_W + x] !== Cell.Wall) continue;
      const below = y + 1 < MAP_H && grid[(y + 1) * MAP_W + x] !== Cell.Wall;
      const X = x * TILE,
        Y = y * TILE;
      rect(ctx, X, Y, TILE, TILE, below ? C.wallFace : C.wallFaceD);
      rect(ctx, X, Y, TILE, 4, C.wallTop);
      rect(ctx, X, Y + 4, TILE, 1, C.wallLine);
      if (below) {
        rect(ctx, X, Y + TILE - 2, TILE, 2, C.wallLine);
        if (x % 2 === 0) rect(ctx, X + 7, Y + 7, 1, 6, C.wallFaceD);
      }
    }

  for (const d of DECOR) drawDecor(ctx, d);

  // room name plates
  ctx.font = `12px ${UI_FONT}`;
  ctx.textBaseline = "top";
  for (const r of ROOMS) {
    const label = r.name;
    const tw = Math.ceil(ctx.measureText(label).width);
    const x = r.x0 * TILE + 4;
    const y = r.y0 * TILE + 3;
    rect(ctx, x, y, tw + 12, 15, "rgba(8,10,18,0.72)");
    rect(ctx, x, y, 3, 15, r.accent);
    ctx.fillStyle = "#e6e9f2";
    ctx.fillText(label, x + 7, y + 2);
  }
  return c;
}

function drawDecor(ctx: Ctx, d: Decor) {
  const X = d.x * TILE,
    Y = d.y * TILE,
    W = d.w * TILE,
    H = d.h * TILE;
  switch (d.kind) {
    case "rug":
      rect(ctx, X + 2, Y + 2, W - 4, H - 4, "#5a2333");
      rect(ctx, X + 5, Y + 5, W - 10, H - 10, "#6e2d40");
      for (let i = X + 8; i < X + W - 8; i += 6) rect(ctx, i, Y + 8, 2, 2, "#8a3e55");
      break;
    case "whiteboard":
      rect(ctx, X + 2, Y + 4, W - 4, 11, "#e9ecf3");
      rect(ctx, X + 2, Y + 14, W - 4, 1, C.metalD);
      ctx.fillStyle = "#4c5bd4";
      for (let i = 0; i < 4; i++) ctx.fillRect(X + 6 + i * 14, Y + 7 + (i % 2) * 3, 9, 1);
      rect(ctx, X + W - 16, Y + 7, 6, 4, "#ffd166");
      break;
    case "chartBoard":
      rect(ctx, X + 3, Y + 4, W - 6, 11, "#e9ecf3");
      [4, 7, 5, 9].forEach((h, i) => rect(ctx, X + 7 + i * 8, Y + 14 - h, 5, h, "#7db85a"));
      break;
    case "mapBoard":
      rect(ctx, X + 2, Y + 4, W - 4, 11, "#c9d6b8");
      rect(ctx, X + 8, Y + 6, 14, 6, "#8fb48a");
      rect(ctx, X + 30, Y + 7, 18, 5, "#8fb48a");
      [12, 36, 52].forEach((x) => rect(ctx, X + x, Y + 8, 2, 2, "#e53935"));
      break;
    case "window":
      rect(ctx, X + 2, Y + 3, W - 4, 11, "#203560");
      rect(ctx, X + 4, Y + 5, 8, 3, "#5e86c4");
      rect(ctx, X + W / 2, Y + 3, 1, 11, C.metalL);
      for (let i = 0; i < 4; i++) rect(ctx, X + 6 + i * 10, Y + 10, 1, 1, "#f6e27a");
      break;
    case "corkboard":
      rect(ctx, X + 2, Y + 4, W - 4, 11, "#b98a5a");
      ["#ffd166", "#ef476f", "#06d6a0", "#118ab2", "#f4f1e8"].forEach((c, i) => rect(ctx, X + 6 + i * 14, Y + 6 + (i % 2) * 2, 8, 6, c));
      break;
    case "tvScreen":
      rect(ctx, X + 4, Y + 3, W - 8, 12, "#11131c");
      rect(ctx, X + 6, Y + 5, W - 12, 8, "#1f3b6e");
      [3, 5, 4, 6].forEach((h, i) => rect(ctx, X + 10 + i * 8, Y + 12 - h, 4, h, "#7ea2ff"));
      break;
    case "kanban":
      rect(ctx, X + 2, Y + 4, W - 4, 11, "#e9ecf3");
      for (let i = 0; i < 3; i++) {
        rect(ctx, X + 3 + i * 15, Y + 4, 1, 11, "#9aa3b8");
        rect(ctx, X + 6 + i * 15, Y + 6, 8, 3, ["#ffd166", "#06d6a0", "#118ab2"][i]);
        rect(ctx, X + 6 + i * 15, Y + 10, 8, 3, ["#ffd166", "#06d6a0", "#118ab2"][i]);
      }
      break;
    case "logo":
      rect(ctx, X + 6, Y + 4, W - 12, 10, "#11131c");
      ctx.font = `9px ${UI_FONT}`;
      ctx.fillStyle = "#e0b44c";
      ctx.textBaseline = "top";
      ctx.fillText("CEO", X + W / 2 - 9, Y + 4);
      break;
    case "doorMat":
      break;
  }
}

// ─── furniture ────────────────────────────────────────────────────

export interface FurnitureArt {
  canvas: HTMLCanvasElement;
  /** Extra pixels drawn above the footprint (tall objects). The image bottom aligns with the footprint bottom. */
  rise: number;
}

export function buildFurniture(f: Furniture): FurnitureArt {
  const W = f.w * TILE,
    H = f.h * TILE;
  switch (f.kind) {
    case "desk":
    case "deskWide": {
      const rise = 6;
      const [c, ctx] = canvas(W, H + rise);
      // shadow
      rect(ctx, 2, rise + H - 2, W - 2, 2, "rgba(0,0,0,0.35)");
      // top surface
      rect(ctx, 0, rise - 2, W, 9, C.woodL);
      rect(ctx, 0, rise - 2, W, 1, shade(C.woodL, 0.15));
      // front panel
      rect(ctx, 0, rise + 7, W, H - 9, C.wood);
      rect(ctx, 0, rise + H - 3, W, 1, C.woodD);
      // drawer handles
      rect(ctx, 4, rise + 10, 4, 1, C.woodD);
      rect(ctx, W - 8, rise + 10, 4, 1, C.woodD);
      // keyboard in front of the work spot
      rect(ctx, TILE + 3, rise + 1, 10, 3, "#c8ccd8");
      rect(ctx, TILE + 4, rise + 2, 8, 1, "#9aa0b2");
      // mug + papers
      rect(ctx, W - 7, rise - 1, 4, 4, C.paper);
      rect(ctx, W - 6, rise, 2, 1, "#6b4a33");
      rect(ctx, W - 14, rise + 1, 6, 4, C.paper);
      return { canvas: c, rise };
    }
    case "bossDesk": {
      const rise = 8;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 2, rise + H - 2, W - 2, 2, "rgba(0,0,0,0.35)");
      rect(ctx, 0, rise - 2, W, 12, "#6e4a33");
      rect(ctx, 0, rise - 2, W, 1, "#8a6046");
      rect(ctx, 0, rise + 10, W, H - 12, "#4e321f");
      rect(ctx, W / 2 - 12, rise + 14, 24, 9, "#e0b44c");
      rect(ctx, W / 2 - 11, rise + 15, 22, 7, "#c99a31");
      ctx.font = `8px ${UI_FONT}`;
      ctx.fillStyle = "#2a1e10";
      ctx.textBaseline = "top";
      ctx.fillText("대표", W / 2 - 8, rise + 14);
      // laptop + documents tray + nameplate
      rect(ctx, 12, rise - 6, 14, 8, "#2b2f3d");
      rect(ctx, 13, rise - 5, 12, 6, "#1f3b6e");
      rect(ctx, W - 22, rise, 12, 6, C.paper);
      rect(ctx, W - 20, rise + 1, 8, 1, "#9aa3b8");
      return { canvas: c, rise };
    }
    case "bossChair": {
      const rise = 14;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 1, 0, W - 2, rise + 6, "#6b3a4a");
      rect(ctx, 3, 2, W - 6, rise + 2, "#8a4c60");
      rect(ctx, 0, rise + 6, W, 5, "#5a2f3d");
      rect(ctx, 6, rise + 11, 4, 5, C.metalD);
      return { canvas: c, rise };
    }
    case "meetingTable": {
      const rise = 4;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 3, rise + H - 2, W - 3, 3, "rgba(0,0,0,0.35)");
      rect(ctx, 0, rise, W, H - 6, "#6e4a33");
      rect(ctx, 3, rise + 3, W - 6, H - 12, "#8a5e42");
      rect(ctx, 0, rise + H - 6, W, 6, "#4e321f");
      // documents and a laptop on the table
      [14, 46, 78, 104].forEach((x, i) => rect(ctx, x, rise + 8 + (i % 2) * 14, 10, 7, C.paper));
      rect(ctx, W / 2 - 8, rise + 16, 16, 10, "#2b2f3d");
      rect(ctx, W / 2 - 7, rise + 17, 14, 7, "#1f3b6e");
      return { canvas: c, rise };
    }
    case "bookshelf": {
      const rise = 10;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 0, 0, W, H + rise, C.woodD);
      rect(ctx, 2, 2, W - 4, H + rise - 4, "#4a2f1e");
      const colors = ["#c0392b", "#2e86c1", "#d4ac0d", "#7d3c98", "#28b463", "#e67e22"];
      for (let row = 0; row < 3; row++) {
        const y = 3 + row * 13;
        rect(ctx, 2, y + 11, W - 4, 2, C.woodD);
        for (let i = 0; i < 6; i++) rect(ctx, 3 + i * 4 + (row % 2), y + 2 + ((i + row) % 3), 3, 9 - ((i + row) % 3), colors[(i + row) % colors.length]);
      }
      return { canvas: c, rise };
    }
    case "serverRack": {
      const rise = 8;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 0, 0, W, H + rise, "#1f2433");
      rect(ctx, 1, 1, W - 2, H + rise - 2, "#2a3042");
      for (let i = 0; i < 9; i++) rect(ctx, 2, 3 + i * 6, W - 4, 4, "#363d52");
      return { canvas: c, rise };
    }
    case "plant": {
      const rise = 10;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 3, rise + 8, 10, 8, C.pot);
      rect(ctx, 3, rise + 8, 10, 2, shade(C.pot, 0.2));
      rect(ctx, 1, rise - 2, 14, 10, C.plantD);
      rect(ctx, 3, rise - 8, 10, 10, C.plant);
      rect(ctx, 0, rise + 1, 4, 4, C.plant);
      rect(ctx, 12, rise - 1, 4, 4, C.plant);
      rect(ctx, 6, rise - 10, 4, 4, shade(C.plant, 0.2));
      return { canvas: c, rise };
    }
    case "sofa": {
      const rise = 6;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 2, rise + H - 2, W - 2, 2, "rgba(0,0,0,0.35)");
      rect(ctx, 0, 0, W, 14, "#3d6f8f");
      rect(ctx, 2, 2, W - 4, 10, "#4b84a8");
      rect(ctx, 0, 12, W, H + rise - 14, "#33607c");
      rect(ctx, 0, 10, 6, H + rise - 12, "#2a5068");
      rect(ctx, W - 6, 10, 6, H + rise - 12, "#2a5068");
      rect(ctx, 8, 14, (W - 18) / 2, 10, "#4b84a8");
      rect(ctx, W / 2 + 1, 14, (W - 18) / 2, 10, "#4b84a8");
      rect(ctx, 12, 4, 8, 6, "#ffd166");
      return { canvas: c, rise };
    }
    case "coffeeMachine": {
      const rise = 6;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 1, 0, W - 2, H + rise, C.metalD);
      rect(ctx, 2, 2, W - 4, 10, C.metal);
      rect(ctx, 4, 4, 8, 3, "#ff7043");
      rect(ctx, 5, 16, 6, 6, "#11131c");
      rect(ctx, 6, 19, 4, 3, C.paper);
      rect(ctx, 2, H + rise - 6, W - 4, 4, C.metalL);
      return { canvas: c, rise };
    }
    case "waterCooler": {
      const rise = 8;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 4, 0, 8, 12, "#6ec6ff");
      rect(ctx, 5, 1, 3, 9, "#a8dcff");
      rect(ctx, 2, 12, 12, H + rise - 12, "#e0e4ee");
      rect(ctx, 6, 16, 4, 2, C.metalD);
      return { canvas: c, rise };
    }
    case "filingCabinet": {
      const rise = 6;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 1, 0, W - 2, H + rise, C.metal);
      for (let i = 0; i < 3; i++) {
        rect(ctx, 2, 2 + i * 12, W - 4, 10, C.metalL);
        rect(ctx, 6, 6 + i * 12, 4, 1, C.metalD);
      }
      return { canvas: c, rise };
    }
    case "safe": {
      const rise = 4;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 0, 0, W, H + rise, "#3b4152");
      rect(ctx, 2, 2, W - 4, H + rise - 4, "#4d5568");
      rect(ctx, W / 2 - 5, (H + rise) / 2 - 5, 10, 10, "#2c3240");
      rect(ctx, W / 2 - 2, (H + rise) / 2 - 2, 4, 4, "#e0b44c");
      return { canvas: c, rise };
    }
    case "loungeTable": {
      const rise = 2;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 2, rise + H - 3, W - 2, 3, "rgba(0,0,0,0.35)");
      rect(ctx, 0, rise + 2, W, H - 8, "#8a5e42");
      rect(ctx, 0, rise + H - 6, W, 4, "#5e3c27");
      rect(ctx, 10, rise + 6, 5, 5, C.paper);
      rect(ctx, 28, rise + 9, 5, 5, C.paper);
      rect(ctx, 18, rise + 4, 10, 6, "#ffd166");
      return { canvas: c, rise };
    }
    case "printer": {
      const rise = 6;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 2, 4, W - 4, H + rise - 4, "#d8dce6");
      rect(ctx, 6, 0, W - 12, 6, C.paper);
      rect(ctx, 4, 12, W - 8, 3, "#9aa0b2");
      rect(ctx, W - 8, 7, 3, 2, "#3be07a");
      return { canvas: c, rise };
    }
    case "trophy": {
      const rise = 8;
      const [c, ctx] = canvas(W, H + rise);
      rect(ctx, 0, 0, W, H + rise, C.woodD);
      rect(ctx, 2, 2, W - 4, H + rise - 4, "#4a2f1e");
      rect(ctx, 6, 6, 8, 8, "#e0b44c");
      rect(ctx, 8, 14, 4, 4, "#c99a31");
      rect(ctx, 18, 8, 8, 10, "#7ea2ff");
      rect(ctx, 4, 26, W - 8, 2, C.woodD);
      rect(ctx, 8, 30, 16, 6, C.paper);
      return { canvas: c, rise };
    }
  }
}

/** Monitor drawn on desks (screen color is painted live by the scene). */
export function buildMonitor(): HTMLCanvasElement {
  const [c, ctx] = canvas(14, 14);
  rect(ctx, 0, 0, 14, 10, "#1b1f2a");
  rect(ctx, 1, 1, 12, 8, C.screenOff);
  rect(ctx, 6, 10, 2, 2, C.metalD);
  rect(ctx, 3, 12, 8, 2, C.metalD);
  return c;
}
