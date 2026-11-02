import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildGrid,
  isWalkable,
  DESKS,
  MEETING_SEATS,
  LOUNGE_SPOTS,
  REPORT_SPOTS,
  HALL_SPOTS,
  FURNITURE,
  ROOMS,
  MAP_W,
  MAP_H,
  Cell,
} from "../src/game/map/officeMap";
import { findPath, corners } from "../src/game/map/pathfinding";
import { EMPLOYEES } from "../src/domain/employees";

const grid = buildGrid();
const allSpots = [
  ...DESKS.map((d) => ({ ...d.work, label: `desk ${d.id}` })),
  ...MEETING_SEATS.map((s, i) => ({ ...s, label: `meeting seat ${i}` })),
  ...LOUNGE_SPOTS.map((s, i) => ({ ...s, label: `lounge ${i}` })),
  ...REPORT_SPOTS.map((s, i) => ({ ...s, label: `report ${i}` })),
  ...HALL_SPOTS.map((s, i) => ({ ...s, label: `hall ${i}` })),
];

test("the map has all nine required rooms", () => {
  const names = ROOMS.map((r) => r.name);
  for (const n of ["CEO 대표실", "전략기획실", "개발실", "시장조사실", "마케팅·영업실", "재무·계약 관리실", "운영 관리실", "회의실", "휴게실"]) {
    assert.ok(names.includes(n), `missing room ${n}`);
  }
});

test("every anchor spot is on a walkable tile", () => {
  for (const s of allSpots) assert.ok(isWalkable(grid, s.x, s.y), `${s.label} at ${s.x},${s.y} is blocked`);
});

test("every employee has a desk, and the desk's work tile sits right above the desk", () => {
  for (const e of EMPLOYEES) {
    const d = DESKS.find((x) => x.id === e.deskId);
    assert.ok(d, `${e.id} has no desk`);
    const f = FURNITURE.find((x) => x.id === d!.furnitureId)!;
    assert.equal(d!.work.y, f.y - 1, `${d!.id} work tile is not directly north of the desk`);
    assert.ok(d!.work.x >= f.x && d!.work.x < f.x + f.w, `${d!.id} work tile is not over the desk`);
  }
});

test("every spot is reachable from every desk and from the lounge", () => {
  const origins = [...DESKS.map((d) => d.work), LOUNGE_SPOTS[0]];
  for (const o of origins) {
    for (const s of allSpots) {
      const p = findPath(grid, o, s);
      assert.ok(p, `no path ${o.x},${o.y} -> ${s.label}`);
    }
  }
});

test("paths never step on walls or furniture and move one tile at a time", () => {
  for (const a of DESKS) {
    for (const b of allSpots) {
      let prev = a.work;
      for (const step of findPath(grid, a.work, b)!) {
        assert.equal(grid[step.y * MAP_W + step.x], Cell.Floor, `path enters blocked tile ${step.x},${step.y}`);
        assert.equal(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 1, "path jumps");
        prev = step;
      }
    }
  }
});

test("unreachable or blocked goals return null", () => {
  assert.equal(findPath(grid, DESKS[0].work, { x: 0, y: 0 }), null); // outer wall
  const f = FURNITURE[0];
  assert.equal(findPath(grid, DESKS[0].work, { x: f.x, y: f.y }), null); // furniture
});

test("corner compression keeps the endpoints and only turning points", () => {
  const start = DESKS[0].work;
  const p = findPath(grid, start, LOUNGE_SPOTS[0])!;
  const c = corners(p, start);
  assert.deepEqual(c[c.length - 1], p[p.length - 1]);
  assert.ok(c.length < p.length);
});

test("the grid is fully enclosed by walls", () => {
  for (let x = 0; x < MAP_W; x++) {
    assert.equal(grid[x], Cell.Wall);
    assert.equal(grid[(MAP_H - 1) * MAP_W + x], Cell.Wall);
  }
  for (let y = 0; y < MAP_H; y++) {
    assert.equal(grid[y * MAP_W], Cell.Wall);
    assert.equal(grid[y * MAP_W + MAP_W - 1], Cell.Wall);
  }
});
