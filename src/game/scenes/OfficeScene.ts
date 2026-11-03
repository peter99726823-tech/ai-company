import Phaser from "phaser";
import { EMPLOYEES } from "@/domain/employees";
import type { Activity } from "@/domain/types";
import {
  TILE,
  MAP_W,
  MAP_H,
  FURNITURE,
  DESKS,
  DESK_BY_ID,
  MEETING_SEATS,
  LOUNGE_SPOTS,
  REPORT_SPOTS,
  HALL_SPOTS,
  DECOR,
  CLOCKS,
  STEAM,
  buildGrid,
  isWalkable,
  type Spot,
  type Grid,
} from "../map/officeMap";
import { buildSheet, ANIMS, FW, FH, FRAME_COUNT } from "../sprites/characterArt";
import { buildBackground, buildFurniture, buildMonitor } from "../sprites/officeArt";
import { Ambience, type Lighting } from "../effects/ambience";

/** The viewer's lighting choice, remembered in this browser only (a per-viewer convenience). */
export const LIGHTING_KEY = "aico-lighting";
function initialLighting(): Lighting {
  try {
    const v = localStorage.getItem(LIGHTING_KEY);
    return v === "day" || v === "night" ? v : "auto";
  } catch {
    return "auto";
  }
}
import { EmployeeActor } from "../entities/EmployeeActor";
import { toGame, fromGame, type ActorCommand, type Destination } from "../bridge";

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export class OfficeScene extends Phaser.Scene {
  private grid!: Grid;
  private actors = new Map<string, EmployeeActor>();
  private speed = 1;
  private screens = new Map<string, Phaser.GameObjects.Graphics>();
  private rackLeds!: Phaser.GameObjects.Graphics;
  private ambience!: Ambience;
  private t = 0;
  private reserved = new Map<string, string>(); // spotKey -> employeeId
  private drag: { x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
  private unsub: (() => void)[] = [];

  constructor() {
    super("office");
  }

  create() {
    this.grid = buildGrid();
    this.buildTextures();

    this.add.image(0, 0, "office-bg").setOrigin(0, 0).setDepth(-10);

    for (const f of FURNITURE) {
      const key = `furn-${f.id}`;
      const img = this.add.image(f.x * TILE, (f.y + f.h) * TILE, key).setOrigin(0, 1);
      img.setDepth((f.y + f.h) * TILE - 0.5);
    }
    for (const d of DESKS) {
      const f = FURNITURE.find((x) => x.id === d.furnitureId)!;
      for (const m of d.monitors) {
        this.add
          .image(Math.round(m.x * TILE), f.y * TILE + 4, "monitor")
          .setOrigin(0, 1)
          .setDepth((f.y + f.h) * TILE);
      }
    }
    for (const d of DESKS) {
      const f = FURNITURE.find((x) => x.id === d.furnitureId)!;
      this.screens.set(d.id, this.add.graphics().setDepth((f.y + f.h) * TILE + 0.1)); // painted per frame
    }
    this.rackLeds = this.add.graphics();
    this.ambience = new Ambience(
      this,
      MAP_W,
      MAP_H,
      DECOR.filter((d) => d.kind === "window").map((d) => ({ x: d.x, y: d.y, w: d.w })),
      CLOCKS,
      STEAM,
    );
    this.ambience.mode = initialLighting();

    // employees: a few start in the lounge so the office looks lived-in from the first frame
    EMPLOYEES.forEach((p, i) => {
      const desk = DESK_BY_ID[p.deskId];
      const inLounge = i % 4 === 2;
      let start: Spot = { ...desk.work, facing: "down" };
      if (inLounge) {
        const s = this.reserve(LOUNGE_SPOTS, p.id);
        if (s) start = s;
      }
      const a = new EmployeeActor(this, this.grid, p, start, (self) => this.publish(self));
      a.ambientPlace = inLounge ? "lounge" : "desk";
      a.ambientTimer = rnd(4, 18);
      if (inLounge) a.setActivity("resting", start.facing);
      this.actors.set(p.id, a);
      this.publish(a);
    });

    this.setupCamera();
    this.setupInput();
    this.listen();
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("test")) this.exposeTestHooks();
    fromGame.emit("ready", undefined);
  }

  // ─── textures ────────────────────────────────────────────────────

  private buildTextures() {
    this.textures.addCanvas("office-bg", buildBackground(this.grid));
    this.textures.addCanvas("monitor", buildMonitor());
    for (const f of FURNITURE) this.textures.addCanvas(`furn-${f.id}`, buildFurniture(f).canvas);
    for (const p of EMPLOYEES) {
      const key = `emp-${p.id}`;
      const sheet = buildSheet(p.look);
      const tex = this.textures.addCanvas(key, sheet)!;
      for (let i = 0; i < FRAME_COUNT; i++) tex.add(i, 0, i * FW, 0, FW, FH);
      for (const [name, a] of Object.entries(ANIMS)) {
        this.anims.create({
          key: `${key}-${name}`,
          frames: a.frames.map((frame) => ({ key, frame })),
          frameRate: a.rate,
          repeat: a.repeat ?? -1,
        });
      }
    }
  }

  // ─── camera ──────────────────────────────────────────────────────

  private fitZoom() {
    const cam = this.cameras.main;
    return Math.min(cam.width / (MAP_W * TILE), cam.height / (MAP_H * TILE));
  }

  private fitAll() {
    const cam = this.cameras.main;
    cam.stopFollow();
    fromGame.emit("following", null);
    cam.setZoom(this.fitZoom());
    cam.centerOn((MAP_W * TILE) / 2, (MAP_H * TILE) / 2);
  }

  /** First view: whole office on wide screens; on tall/narrow screens fill the height and let the player drag sideways. */
  private initialView() {
    const cam = this.cameras.main;
    if (cam.width < cam.height * 1.1) {
      cam.setZoom(Math.max(this.fitZoom(), (cam.height / (MAP_H * TILE)) * 0.98));
      cam.centerOn(MAP_W * TILE * 0.3, (MAP_H * TILE) / 2);
    } else this.fitAll();
  }

  private setupCamera() {
    const cam = this.cameras.main;
    cam.setBackgroundColor("#0b0d15");
    cam.setRoundPixels(false);
    this.initialView();
    this.scale.on("resize", (size: Phaser.Structs.Size) => {
      cam.setSize(size.width, size.height);
      if (cam.zoom < this.fitZoom()) this.fitAll();
    });
  }

  private zoomAt(factor: number, sx?: number, sy?: number) {
    const cam = this.cameras.main;
    const min = Math.max(0.4, this.fitZoom() * 0.9);
    const next = Phaser.Math.Clamp(cam.zoom * factor, min, 5);
    const px = sx ?? cam.width / 2;
    const py = sy ?? cam.height / 2;
    const before = cam.getWorldPoint(px, py);
    cam.setZoom(next);
    const after = cam.getWorldPoint(px, py);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
  }

  private setupInput() {
    this.input.on("wheel", (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(dy > 0 ? 0.88 : 1.14, p.x, p.y);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.drag = { x: p.x, y: p.y, sx: this.cameras.main.scrollX, sy: this.cameras.main.scrollY, moved: false };
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.drag || !p.isDown) return;
      const cam = this.cameras.main;
      const dx = p.x - this.drag.x,
        dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) > 4) {
        this.drag.moved = true;
        cam.stopFollow();
        fromGame.emit("following", null);
      }
      if (this.drag.moved) {
        cam.scrollX = this.drag.sx - dx / cam.zoom;
        cam.scrollY = this.drag.sy - dy / cam.zoom;
      }
    });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const wasDrag = this.drag?.moved;
      this.drag = null;
      if (wasDrag) return;
      const w = this.cameras.main.getWorldPoint(p.x, p.y);
      // topmost (largest y) employee under the pointer
      let hit: EmployeeActor | null = null;
      for (const a of this.actors.values()) if (a.hitTest(w.x, w.y) && (!hit || a.sprite.y > hit.sprite.y)) hit = a;
      this.select(hit ? hit.profile.id : null);
    });
  }

  private select(id: string | null) {
    for (const a of this.actors.values()) a.setSelected(a.profile.id === id);
    fromGame.emit("selected", id);
  }

  private follow(id: string | null) {
    const cam = this.cameras.main;
    const a = id ? this.actors.get(id) : null;
    if (!a) {
      cam.stopFollow();
      fromGame.emit("following", null);
      return;
    }
    if (cam.zoom < 2) cam.setZoom(Math.max(2.5, this.fitZoom()));
    cam.startFollow(a.sprite, true, 0.12, 0.12, 0, 18);
    fromGame.emit("following", id);
  }

  // ─── bridge ──────────────────────────────────────────────────────

  private listen() {
    this.unsub.push(
      toGame.on("select", (id) => this.select(id)),
      toGame.on("fit", () => this.fitAll()),
      toGame.on("follow", (id) => this.follow(id)),
      toGame.on("zoomBy", (f) => this.zoomAt(f)),
      toGame.on("speed", (s) => {
        this.speed = s;
        for (const a of this.actors.values()) a.setTimeScale(s);
      }),
      toGame.on("command", (c) => this.command(c)),
      toGame.on("release", (id) => this.release(id)),
      toGame.on("lighting", (m) => (this.ambience.mode = m)),
    );
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.unsub.forEach((u) => u()));
  }

  private publish(a: EmployeeActor) {
    fromGame.emit("actor", {
      id: a.profile.id,
      activity: a.activity,
      roomName: a.roomName,
      moving: a.moving,
      bubble: a.bubbleValue,
      mode: a.mode,
    });
  }

  private spotKey(s: Spot) {
    return `${s.x},${s.y}`;
  }

  private reserve(spots: Spot[], id: string): Spot | null {
    this.freeSpot(id);
    const free = spots.filter((s) => !this.reserved.has(this.spotKey(s)));
    if (!free.length) return null;
    const s = free[Math.floor(Math.random() * free.length)];
    this.reserved.set(this.spotKey(s), id);
    return s;
  }

  private freeSpot(id: string) {
    for (const [k, v] of this.reserved) if (v === id) this.reserved.delete(k);
  }

  private destination(a: EmployeeActor, go: Destination): Spot | null {
    switch (go) {
      case "desk":
        this.freeSpot(a.profile.id);
        return { ...DESK_BY_ID[a.profile.deskId].work, facing: "down" };
      case "meeting":
        return this.reserve(MEETING_SEATS, a.profile.id);
      case "lounge":
        return this.reserve(LOUNGE_SPOTS, a.profile.id);
      case "report":
        return this.reserve(REPORT_SPOTS, a.profile.id);
      case "stay":
        return null;
    }
  }

  /** Real-task (PHASE 2) or preview command: walk somewhere, then show an activity. */
  private lastGo = new Map<string, Destination>();

  private command(c: ActorCommand) {
    const a = this.actors.get(c.id);
    if (!a) return;
    a.mode = c.source;
    if (c.bubble !== undefined) a.setBubble(c.bubble);
    // Same place as before: only the pose/bubble changes, no new walk.
    if (this.lastGo.get(c.id) === c.go && c.go !== "stay") {
      if (a.moving) a.retarget(c.activity);
      else a.setActivity(c.activity, a.facing);
      this.publish(a);
      return;
    }
    this.lastGo.set(c.id, c.go);
    const spot = this.destination(a, c.go);
    if (spot) {
      if (!a.goTo(spot, c.activity)) a.setActivity("error");
      this.movement(a, c.go, c.activity);
    } else a.setActivity(c.activity);
    this.publish(a);
  }

  private release(id: string) {
    const a = this.actors.get(id);
    if (!a) return;
    this.lastGo.delete(id);
    a.mode = "ambient";
    a.setBubble(null);
    a.ambientPlace = "desk";
    a.ambientTimer = rnd(10, 25);
    const spot = this.destination(a, "desk")!;
    a.goTo(spot, "idle");
    this.publish(a);
  }

  private movement(a: EmployeeActor, go: Destination, activity: Activity) {
    const where: Record<Destination, string> = { desk: "자기 책상", meeting: "회의실", lounge: "휴게실", report: "대표실", stay: "제자리" };
    fromGame.emit("movement", { id: a.profile.id, text: `${where[go]}(으)로 이동 → ${activity}` });
  }

  /**
   * Ambient idling for employees with no task: sit at the desk, take a break in the lounge,
   * stretch in the hallway. Labelled 대기/휴식 — never presented as work.
   */
  private ambient(a: EmployeeActor, dt: number) {
    if (a.mode !== "ambient" || a.moving) return;
    a.ambientTimer -= dt;
    if (a.ambientTimer > 0) return;
    if (a.ambientPlace === "desk") {
      const r = Math.random();
      if (r < 0.45) {
        const s = this.reserve(LOUNGE_SPOTS, a.profile.id);
        if (s && a.goTo(s, "resting")) {
          a.ambientPlace = "lounge";
          a.ambientTimer = rnd(18, 35);
          fromGame.emit("movement", { id: a.profile.id, text: "휴게실로 가서 쉬는 중" });
          return;
        }
      } else if (r < 0.65) {
        const s = HALL_SPOTS[Math.floor(Math.random() * HALL_SPOTS.length)];
        if (a.goTo(s, "idle")) {
          a.ambientPlace = "hall";
          a.ambientTimer = rnd(3, 6);
          return;
        }
      }
      a.ambientTimer = rnd(15, 30);
    } else {
      this.freeSpot(a.profile.id);
      a.goTo({ ...DESK_BY_ID[a.profile.deskId].work, facing: "down" }, "idle");
      a.ambientPlace = "desk";
      a.ambientTimer = rnd(20, 40);
      if (Math.random() < 0.5) fromGame.emit("movement", { id: a.profile.id, text: "자기 책상으로 복귀" });
    }
  }

  // ─── test hooks (only with ?test=1) ──────────────────────────────

  private violations: string[] = [];
  private testMode = false;

  private exposeTestHooks() {
    this.testMode = true;
    (window as unknown as Record<string, unknown>).__officeTest = {
      /** Screen (CSS px, relative to the canvas) of an employee's chest. */
      screenPos: (id: string) => {
        const a = this.actors.get(id)!;
        const cam = this.cameras.main;
        return { x: (a.sprite.x - cam.worldView.x) * cam.zoom, y: (a.sprite.y - 12 - cam.worldView.y) * cam.zoom };
      },
      actors: () =>
        [...this.actors.values()].map((a) => ({ id: a.profile.id, x: a.sprite.x, y: a.sprite.y, activity: a.activity, moving: a.moving, anim: a.sprite.anims.currentAnim?.key, bubble: a.bubbleValue, mode: a.mode })),
      camera: () => ({ zoom: this.cameras.main.zoom, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY }),
      violations: () => this.violations.slice(),
      screenLit: (deskId: string) => {
        const owner = [...this.actors.values()].find((a) => a.profile.deskId === deskId);
        return !!owner && owner.activity === "working" && !owner.moving;
      },
    };
  }

  private checkCollisions() {
    for (const a of this.actors.values()) {
      const tx = Math.floor(a.sprite.x / TILE),
        ty = Math.floor(a.sprite.y / TILE);
      if (!isWalkable(this.grid, tx, ty) && this.violations.length < 50) this.violations.push(`${a.profile.id}@${tx},${ty}`);
    }
  }

  // ─── frame ───────────────────────────────────────────────────────

  update(_time: number, deltaMs: number) {
    const dt = Math.min(0.1, deltaMs / 1000) * this.speed;
    this.t += dt;
    for (const a of this.actors.values()) {
      const wasMoving = a.moving;
      a.update(dt, this.cameras.main.zoom);
      this.ambient(a, dt);
      if (wasMoving && !a.moving) this.publish(a);
    }
    this.paintScreens();
    this.paintLeds();
    this.ambience.update(this.t, this.lampSpots());
    if (this.testMode) this.checkCollisions();
  }

  /** Desk lamps at night: one per desk whose owner is sitting there, plus the founder's own desk. */
  private lampSpots() {
    const out: { x: number; y: number }[] = [{ x: 6, y: 7 }];
    for (const d of DESKS) {
      const owner = [...this.actors.values()].find((a) => a.profile.deskId === d.id);
      if (!owner || owner.moving) continue;
      const tx = Math.floor(owner.sprite.x / TILE),
        ty = Math.floor(owner.sprite.y / TILE);
      if (Math.abs(tx - d.work.x) <= 1 && Math.abs(ty - d.work.y) <= 1) out.push({ x: d.work.x, y: d.work.y });
    }
    return out;
  }

  /** Monitor screens light up only while the desk owner is actually in the "working" state at the desk. */
  private paintScreens() {
    for (const d of DESKS) {
      const g = this.screens.get(d.id)!;
      g.clear();
      const owner = [...this.actors.values()].find((a) => a.profile.deskId === d.id);
      const f = FURNITURE.find((x) => x.id === d.furnitureId)!;
      const on = !!owner && owner.activity === "working" && !owner.moving;
      for (const m of d.monitors) {
        const x = Math.round(m.x * TILE) + 1;
        const y = f.y * TILE + 4 - 13;
        g.fillStyle(on ? 0x24406e : 0x141824, 1).fillRect(x, y, 12, 8);
        if (on) {
          g.fillStyle(0x9fd3ff, 1);
          for (let i = 0; i < 3; i++) {
            const w = 3 + ((Math.floor(this.t * 6) + i * 5) % 8);
            g.fillRect(x + 1, y + 1 + i * 2.5, w, 1);
          }
        } else if (owner && owner.mode === "ambient") {
          g.fillStyle(0x2a3350, 1).fillRect(x + 5, y + 3, 2, 2); // standby dot
        }
      }
    }
  }

  private paintLeds() {
    const g = this.rackLeds;
    g.clear();
    for (const rx of [60, 61]) {
      for (let i = 0; i < 8; i++) {
        const on = (Math.floor(this.t * 3 + i * 1.7 + rx) % 3) !== 0;
        g.fillStyle(on ? 0x3be07a : 0x14301f, 1).fillRect(rx * TILE + 11, 1 * TILE - 4 + i * 6 + 3, 2, 2);
        g.fillStyle((Math.floor(this.t * 5 + i) % 4) !== 0 ? 0xffb547 : 0x3a2a10, 1).fillRect(rx * TILE + 3, 1 * TILE - 4 + i * 6 + 3, 2, 2);
      }
    }
    g.setDepth(4 * TILE + 1);
  }
}
