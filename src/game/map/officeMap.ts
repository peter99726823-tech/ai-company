/**
 * The office as a tile grid. Pure data — no Phaser import — so it can be unit-tested in Node.
 *
 * Coordinates are tiles. TILE = 16 px. Walls and blocking furniture are not walkable;
 * pathfinding (./pathfinding.ts) only ever returns walkable tiles, which is how
 * "no walking through walls or furniture" is enforced.
 */
import type { RoomId } from "@/domain/types";

export const TILE = 16;
export const MAP_W = 64;
export const MAP_H = 40;

export const Cell = { Floor: 0, Wall: 1, Furniture: 2 } as const;

export interface Room {
  id: RoomId;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number; // interior, inclusive
  floor: [string, string]; // checker colors
  accent: string;
}

export type FurnitureKind =
  | "desk"
  | "deskWide"
  | "bossDesk"
  | "bossChair"
  | "meetingTable"
  | "bookshelf"
  | "serverRack"
  | "plant"
  | "sofa"
  | "coffeeMachine"
  | "waterCooler"
  | "filingCabinet"
  | "safe"
  | "loungeTable"
  | "printer"
  | "trophy";

/** Flat decor is drawn into the background and never blocks. */
export type DecorKind = "rug" | "whiteboard" | "corkboard" | "kanban" | "tvScreen" | "chartBoard" | "mapBoard" | "window" | "doorMat" | "logo";

export interface Furniture {
  id: string;
  kind: FurnitureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  room: RoomId;
}

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Desk {
  id: string;
  room: RoomId;
  furnitureId: string;
  /** Tile the employee stands on while working (directly north of the desk, facing down). */
  work: { x: number; y: number };
  /** Monitor positions in tiles (fractional allowed) used for the screen glow. */
  monitors: { x: number; y: number }[];
}

export interface Spot {
  x: number;
  y: number;
  facing: "down" | "up" | "left" | "right";
}

export const ROOMS: Room[] = [
  { id: "ceo", name: "CEO 대표실", x0: 1, y0: 1, x1: 12, y1: 14, floor: ["#3a2a35", "#40303b"], accent: "#e0b44c" },
  { id: "strategy", name: "전략기획실", x0: 14, y0: 1, x1: 29, y1: 14, floor: ["#262c40", "#2a3146"], accent: "#e0b44c" },
  { id: "research", name: "시장조사실", x0: 31, y0: 1, x1: 43, y1: 14, floor: ["#21323a", "#25373f"], accent: "#4fd1c5" },
  { id: "dev", name: "개발실", x0: 45, y0: 1, x1: 62, y1: 14, floor: ["#232742", "#272b48"], accent: "#7c8cff" },
  { id: "salesMarketing", name: "마케팅·영업실", x0: 1, y0: 21, x1: 15, y1: 38, floor: ["#3a2a2f", "#402f35"], accent: "#ff8a65" },
  { id: "meeting", name: "회의실", x0: 17, y0: 21, x1: 30, y1: 38, floor: ["#2c2840", "#312c47"], accent: "#c792ea" },
  { id: "financeLegal", name: "재무·계약 관리실", x0: 32, y0: 21, x1: 44, y1: 38, floor: ["#28331f", "#2d3923"], accent: "#9ccc65" },
  { id: "ops", name: "운영 관리실", x0: 46, y0: 21, x1: 54, y1: 38, floor: ["#3a3122", "#403626"], accent: "#ffb547" },
  { id: "lounge", name: "휴게실", x0: 56, y0: 21, x1: 62, y1: 38, floor: ["#2f3a35", "#34403a"], accent: "#80cbc4" },
];

export const CORRIDOR = { x0: 1, y0: 16, x1: 62, y1: 19 };

/** Door openings (tiles cut out of wall rows). */
export const DOORS: { x: number; y: number }[] = [
  // wall row y=15 (top rooms)
  ...[6, 7, 21, 22, 37, 38, 53, 54].map((x) => ({ x, y: 15 })),
  // wall row y=20 (bottom rooms)
  ...[8, 9, 23, 24, 38, 39, 50, 51, 58, 59].map((x) => ({ x, y: 20 })),
];

export const FURNITURE: Furniture[] = [
  // CEO 대표실 — the founder's own office. The chair stays empty: the founder is the player.
  { id: "boss-desk", kind: "bossDesk", x: 4, y: 7, w: 5, h: 2, room: "ceo" },
  { id: "boss-chair", kind: "bossChair", x: 6, y: 5, w: 1, h: 1, room: "ceo" },
  { id: "ceo-shelf", kind: "bookshelf", x: 10, y: 1, w: 2, h: 2, room: "ceo" },
  { id: "ceo-trophy", kind: "trophy", x: 1, y: 5, w: 2, h: 2, room: "ceo" },
  { id: "ceo-plant-1", kind: "plant", x: 1, y: 13, w: 1, h: 1, room: "ceo" },
  { id: "ceo-plant-2", kind: "plant", x: 12, y: 13, w: 1, h: 1, room: "ceo" },

  // 전략기획실
  { id: "desk-strategy-1", kind: "desk", x: 16, y: 8, w: 3, h: 1, room: "strategy" },
  { id: "desk-strategy-2", kind: "desk", x: 23, y: 8, w: 3, h: 1, room: "strategy" },
  { id: "strategy-shelf", kind: "bookshelf", x: 27, y: 1, w: 2, h: 2, room: "strategy" },
  { id: "strategy-plant", kind: "plant", x: 14, y: 13, w: 1, h: 1, room: "strategy" },
  { id: "strategy-plant-2", kind: "plant", x: 29, y: 13, w: 1, h: 1, room: "strategy" },

  // 시장조사실
  { id: "desk-research-1", kind: "desk", x: 34, y: 8, w: 3, h: 1, room: "research" },
  { id: "research-cab-1", kind: "filingCabinet", x: 41, y: 1, w: 1, h: 2, room: "research" },
  { id: "research-cab-2", kind: "filingCabinet", x: 42, y: 1, w: 1, h: 2, room: "research" },
  { id: "research-plant", kind: "plant", x: 43, y: 13, w: 1, h: 1, room: "research" },

  // 개발실
  { id: "desk-dev-1", kind: "deskWide", x: 49, y: 8, w: 4, h: 1, room: "dev" },
  { id: "desk-dev-2", kind: "desk", x: 55, y: 11, w: 3, h: 1, room: "dev" },
  { id: "dev-rack-1", kind: "serverRack", x: 60, y: 1, w: 1, h: 3, room: "dev" },
  { id: "dev-rack-2", kind: "serverRack", x: 61, y: 1, w: 1, h: 3, room: "dev" },
  { id: "dev-printer", kind: "printer", x: 45, y: 12, w: 2, h: 1, room: "dev" },
  { id: "dev-plant", kind: "plant", x: 62, y: 13, w: 1, h: 1, room: "dev" },

  // 마케팅·영업실
  { id: "desk-sales-1", kind: "desk", x: 3, y: 28, w: 3, h: 1, room: "salesMarketing" },
  { id: "desk-sales-2", kind: "desk", x: 10, y: 28, w: 3, h: 1, room: "salesMarketing" },
  { id: "sales-plant", kind: "plant", x: 1, y: 37, w: 1, h: 1, room: "salesMarketing" },
  { id: "sales-plant-2", kind: "plant", x: 15, y: 37, w: 1, h: 1, room: "salesMarketing" },
  { id: "sales-shelf", kind: "bookshelf", x: 13, y: 21, w: 2, h: 2, room: "salesMarketing" },

  // 회의실
  { id: "meeting-table", kind: "meetingTable", x: 20, y: 27, w: 8, h: 3, room: "meeting" },
  { id: "meeting-plant-1", kind: "plant", x: 17, y: 37, w: 1, h: 1, room: "meeting" },
  { id: "meeting-plant-2", kind: "plant", x: 30, y: 37, w: 1, h: 1, room: "meeting" },

  // 재무·계약 관리실
  { id: "desk-finance-1", kind: "desk", x: 34, y: 28, w: 3, h: 1, room: "financeLegal" },
  { id: "desk-finance-2", kind: "desk", x: 40, y: 28, w: 3, h: 1, room: "financeLegal" },
  { id: "finance-safe", kind: "safe", x: 43, y: 21, w: 2, h: 2, room: "financeLegal" },
  { id: "finance-cab", kind: "filingCabinet", x: 32, y: 35, w: 1, h: 2, room: "financeLegal" },
  { id: "finance-cab-2", kind: "filingCabinet", x: 33, y: 35, w: 1, h: 2, room: "financeLegal" },
  { id: "finance-plant", kind: "plant", x: 44, y: 37, w: 1, h: 1, room: "financeLegal" },

  // 운영 관리실
  { id: "desk-ops-1", kind: "desk", x: 48, y: 28, w: 3, h: 1, room: "ops" },
  { id: "ops-cab", kind: "filingCabinet", x: 54, y: 21, w: 1, h: 2, room: "ops" },
  { id: "ops-plant", kind: "plant", x: 46, y: 37, w: 1, h: 1, room: "ops" },

  // 휴게실
  { id: "lounge-sofa", kind: "sofa", x: 57, y: 33, w: 4, h: 2, room: "lounge" },
  { id: "lounge-coffee", kind: "coffeeMachine", x: 61, y: 22, w: 1, h: 2, room: "lounge" },
  { id: "lounge-water", kind: "waterCooler", x: 56, y: 24, w: 1, h: 2, room: "lounge" },
  { id: "lounge-table", kind: "loungeTable", x: 58, y: 28, w: 3, h: 2, room: "lounge" },
  { id: "lounge-plant", kind: "plant", x: 62, y: 37, w: 1, h: 1, room: "lounge" },
  { id: "lounge-plant-2", kind: "plant", x: 56, y: 37, w: 1, h: 1, room: "lounge" },
];

export const DECOR: Decor[] = [
  { kind: "rug", x: 3, y: 4, w: 7, h: 8 },
  { kind: "whiteboard", x: 16, y: 0, w: 5, h: 1 },
  { kind: "chartBoard", x: 22, y: 0, w: 3, h: 1 },
  { kind: "mapBoard", x: 33, y: 0, w: 5, h: 1 },
  { kind: "window", x: 48, y: 0, w: 3, h: 1 },
  { kind: "window", x: 53, y: 0, w: 3, h: 1 },
  { kind: "corkboard", x: 2, y: 20, w: 5, h: 1 },
  { kind: "tvScreen", x: 18, y: 20, w: 4, h: 1 },
  { kind: "kanban", x: 47, y: 20, w: 3, h: 1 },
  { kind: "chartBoard", x: 34, y: 20, w: 3, h: 1 },
  { kind: "rug", x: 57, y: 27, w: 5, h: 4 },
];

export const DESKS: Desk[] = [
  { id: "desk-strategy-1", room: "strategy", furnitureId: "desk-strategy-1", work: { x: 17, y: 7 }, monitors: [{ x: 16.6, y: 8 }] },
  { id: "desk-strategy-2", room: "strategy", furnitureId: "desk-strategy-2", work: { x: 24, y: 7 }, monitors: [{ x: 23.6, y: 8 }] },
  { id: "desk-research-1", room: "research", furnitureId: "desk-research-1", work: { x: 35, y: 7 }, monitors: [{ x: 34.6, y: 8 }] },
  { id: "desk-dev-1", room: "dev", furnitureId: "desk-dev-1", work: { x: 51, y: 7 }, monitors: [{ x: 49.6, y: 8 }, { x: 52.2, y: 8 }] },
  { id: "desk-sales-1", room: "salesMarketing", furnitureId: "desk-sales-1", work: { x: 4, y: 27 }, monitors: [{ x: 3.6, y: 28 }] },
  { id: "desk-sales-2", room: "salesMarketing", furnitureId: "desk-sales-2", work: { x: 11, y: 27 }, monitors: [{ x: 10.6, y: 28 }] },
  { id: "desk-finance-1", room: "financeLegal", furnitureId: "desk-finance-1", work: { x: 35, y: 27 }, monitors: [{ x: 34.6, y: 28 }] },
  { id: "desk-finance-2", room: "financeLegal", furnitureId: "desk-finance-2", work: { x: 41, y: 27 }, monitors: [{ x: 40.6, y: 28 }] },
  { id: "desk-ops-1", room: "ops", furnitureId: "desk-ops-1", work: { x: 49, y: 27 }, monitors: [{ x: 48.6, y: 28 }] },
];

export const DESK_BY_ID = Object.fromEntries(DESKS.map((d) => [d.id, d])) as Record<string, Desk>;

/** Seats around the meeting table: north side faces down (seen from the front), south side faces up. */
export const MEETING_SEATS: Spot[] = [
  { x: 21, y: 26, facing: "down" },
  { x: 23, y: 26, facing: "down" },
  { x: 25, y: 26, facing: "down" },
  { x: 27, y: 26, facing: "down" },
  { x: 19, y: 28, facing: "right" },
  { x: 28, y: 28, facing: "left" },
  { x: 21, y: 30, facing: "up" },
  { x: 23, y: 30, facing: "up" },
  { x: 25, y: 30, facing: "up" },
  { x: 27, y: 30, facing: "up" },
];

/** Where employees relax when they have no task. */
export const LOUNGE_SPOTS: Spot[] = [
  { x: 57, y: 32, facing: "down" },
  { x: 59, y: 32, facing: "down" },
  { x: 60, y: 32, facing: "down" },
  { x: 61, y: 24, facing: "up" },
  { x: 57, y: 25, facing: "up" },
  { x: 62, y: 29, facing: "left" },
  { x: 57, y: 29, facing: "right" },
  { x: 59, y: 36, facing: "up" },
];

/** In front of the founder's desk: where employees deliver reports. */
export const REPORT_SPOTS: Spot[] = [
  { x: 5, y: 10, facing: "up" },
  { x: 6, y: 10, facing: "up" },
  { x: 7, y: 10, facing: "up" },
  { x: 4, y: 11, facing: "up" },
  { x: 8, y: 11, facing: "up" },
];

/** Hallway spots used for short idle wandering. */
export const HALL_SPOTS: Spot[] = [
  { x: 11, y: 17, facing: "down" },
  { x: 27, y: 18, facing: "down" },
  { x: 43, y: 17, facing: "down" },
  { x: 56, y: 18, facing: "down" },
];

// ─── grid ────────────────────────────────────────────────────────────────

export type Grid = Uint8Array; // index = y * MAP_W + x

export function buildGrid(): Grid {
  const g = new Uint8Array(MAP_W * MAP_H).fill(Cell.Wall);
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y * MAP_W + x] = Cell.Floor;
  };
  for (const r of ROOMS) carve(r.x0, r.y0, r.x1, r.y1);
  carve(CORRIDOR.x0, CORRIDOR.y0, CORRIDOR.x1, CORRIDOR.y1);
  for (const d of DOORS) g[d.y * MAP_W + d.x] = Cell.Floor;
  for (const f of FURNITURE) {
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) g[y * MAP_W + x] = Cell.Furniture;
  }
  return g;
}

export const isWalkable = (g: Grid, x: number, y: number) =>
  x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && g[y * MAP_W + x] === Cell.Floor;

export function roomAt(x: number, y: number): Room | null {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) ?? null;
}
