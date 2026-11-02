import Phaser from "phaser";
import type { Activity, EmployeeProfile } from "@/domain/types";
import { ACTIVITY_LABEL } from "@/domain/types";
import { TILE, type Grid, type Spot, roomAt } from "../map/officeMap";
import { findPath, corners, type Pt } from "../map/pathfinding";
import { UI_FONT } from "../sprites/officeArt";

const WALK_SPEED = 46; // px per second at 1x

export const ACTIVITY_COLOR: Record<Activity, number> = {
  idle: 0x8a93a8,
  walk: 0x7ea2ff,
  working: 0x5fd08a,
  thinking: 0xf0b35a,
  meeting: 0xc792ea,
  reporting: 0x4fd1c5,
  resting: 0x80cbc4,
  error: 0xff6b6b,
  waiting: 0xffb547,
};

type Facing = Spot["facing"];

export class EmployeeActor {
  readonly profile: EmployeeProfile;
  readonly sprite: Phaser.GameObjects.Sprite;
  private readonly shadow: Phaser.GameObjects.Ellipse;
  private readonly ring: Phaser.GameObjects.Graphics;
  private readonly tag: Phaser.GameObjects.Container;
  private readonly tagBg: Phaser.GameObjects.Graphics;
  private readonly tagText: Phaser.GameObjects.Text;
  private readonly bubble: Phaser.GameObjects.Container;
  private readonly bubbleBg: Phaser.GameObjects.Graphics;
  private readonly bubbleText: Phaser.GameObjects.Text;

  tile: Pt;
  activity: Activity = "idle";
  facing: Facing = "down";
  mode: "ambient" | "task" | "preview" = "ambient";
  /** Ambient scheduling (game-time seconds). */
  ambientTimer = 0;
  ambientPlace: "desk" | "lounge" | "hall" = "desk";
  reservedSpot: string | null = null;

  private waypoints: { x: number; y: number }[] = [];
  private arrive: { activity: Activity; facing: Facing } | null = null;
  private selected = false;
  private bubbleTextValue: string | null = null;
  private pulse = 0;
  private onChange: (self: EmployeeActor) => void;

  constructor(
    private scene: Phaser.Scene,
    private grid: Grid,
    profile: EmployeeProfile,
    start: Spot,
    onChange: (self: EmployeeActor) => void,
  ) {
    this.profile = profile;
    this.tile = { x: start.x, y: start.y };
    this.onChange = onChange;
    const { x, y } = this.feet(start);

    this.shadow = scene.add.ellipse(x, y - 1, 12, 4, 0x000000, 0.35);
    this.ring = scene.add.graphics();
    this.sprite = scene.add.sprite(x, y, `emp-${profile.id}`, 12).setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true, pixelPerfect: false });
    this.sprite.setData("employeeId", profile.id);

    // name + status tag
    this.tagBg = scene.add.graphics();
    this.tagText = scene.add
      .text(0, 0, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#e6e9f2", resolution: 3 })
      .setOrigin(0, 0.5);
    this.tagText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.tag = scene.add.container(x, y - 30, [this.tagBg, this.tagText]);

    // speech bubble
    this.bubbleBg = scene.add.graphics();
    this.bubbleText = scene.add
      .text(0, 0, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#1a1d27", resolution: 3, wordWrap: { width: 220 } })
      .setOrigin(0.5, 0.5);
    this.bubbleText.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    this.bubble = scene.add.container(x, y - 44, [this.bubbleBg, this.bubbleText]).setVisible(false);

    this.setActivity("idle", start.facing);
  }

  private feet(p: Pt) {
    return { x: p.x * TILE + TILE / 2, y: p.y * TILE + TILE - 1 };
  }

  get moving() {
    return this.waypoints.length > 0;
  }

  get roomName() {
    return roomAt(this.tile.x, this.tile.y)?.name ?? "복도";
  }

  setSelected(v: boolean) {
    this.selected = v;
    this.redrawTag();
  }

  /** Walk to a spot via A*, then play `activity` facing the spot's direction. Returns false if unreachable. */
  goTo(spot: Spot, activity: Activity): boolean {
    // Start from the tile we are actually standing on (we may be mid-walk).
    const cur = { x: Math.floor(this.sprite.x / TILE), y: Math.floor(this.sprite.y / TILE) };
    const path = findPath(this.grid, cur, spot);
    if (!path) return false;
    if (path.length === 0) {
      this.waypoints = [this.feet(cur)];
      this.arrive = { activity, facing: spot.facing };
      this.tile = { x: spot.x, y: spot.y };
      return true;
    }
    this.waypoints = [this.feet(cur), ...corners(path, cur).map((p) => this.feet(p))];
    this.arrive = { activity, facing: spot.facing };
    this.tile = { x: spot.x, y: spot.y };
    this.activity = "walk";
    this.redrawTag();
    this.onChange(this);
    return true;
  }

  setActivity(activity: Activity, facing: Facing = this.facing) {
    this.activity = activity;
    this.facing = facing;
    this.sprite.setFlipX(facing === "right");
    const dir = facing === "down" ? "down" : facing === "up" ? "up" : "side";
    let key: string;
    switch (activity) {
      case "idle":
      case "walk":
        key = `idle-${dir}`;
        break;
      case "meeting":
        key = `meeting-${dir}`;
        break;
      default:
        // Working, thinking, reporting, resting, error, waiting are front-facing poses.
        key = activity;
        if (dir !== "down") this.sprite.setFlipX(false);
    }
    this.sprite.play(`emp-${this.profile.id}-${key}`, true);
    this.redrawTag();
    this.onChange(this);
  }

  setBubble(text: string | null) {
    if (text === this.bubbleTextValue) return;
    this.bubbleTextValue = text;
    if (!text) {
      this.bubble.setVisible(false);
    } else {
      this.bubbleText.setText(text);
      const w = Math.ceil(this.bubbleText.width) + 16;
      const h = Math.ceil(this.bubbleText.height) + 10;
      const g = this.bubbleBg;
      g.clear();
      g.fillStyle(0x000000, 0.35).fillRoundedRect(-w / 2 + 2, -h / 2 + 2, w, h, 6);
      g.fillStyle(0xf4f1e8, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 6);
      g.fillTriangle(-5, h / 2 - 1, 5, h / 2 - 1, 0, h / 2 + 6);
      this.bubble.setVisible(true);
    }
    this.onChange(this);
  }

  get bubbleValue() {
    return this.bubbleTextValue;
  }

  private redrawTag() {
    const label = `${this.profile.name}  ${ACTIVITY_LABEL[this.activity]}`;
    this.tagText.setText(label);
    const w = Math.ceil(this.tagText.width) + 22;
    const h = 20;
    const color = ACTIVITY_COLOR[this.activity];
    const accent = Phaser.Display.Color.HexStringToColor(this.profile.look.accent).color;
    const g = this.tagBg;
    g.clear();
    g.fillStyle(this.selected ? accent : 0x0c0e16, this.selected ? 1 : 0.82).fillRoundedRect(-w / 2, -h / 2, w, h, 5);
    g.lineStyle(2, this.selected ? 0xffffff : accent, this.selected ? 0.9 : 0.7).strokeRoundedRect(-w / 2, -h / 2, w, h, 5);
    g.fillStyle(color, 1).fillCircle(-w / 2 + 9, 0, 4);
    this.tagText.setColor(this.selected ? "#111318" : "#e6e9f2");
    this.tagText.setPosition(-w / 2 + 17, 0);
  }

  /** dt in seconds of *game* time (already multiplied by game speed); zoom keeps labels a constant screen size. */
  update(dt: number, zoom = 1) {
    if (this.waypoints.length) {
      let budget = WALK_SPEED * dt;
      while (budget > 0 && this.waypoints.length) {
        const wp = this.waypoints[0];
        const dx = wp.x - this.sprite.x;
        const dy = wp.y - this.sprite.y;
        const d = Math.hypot(dx, dy);
        const dir: Facing = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : dy < 0 ? "up" : "down";
        this.playWalk(dir);
        if (d <= budget) {
          this.sprite.setPosition(wp.x, wp.y);
          this.waypoints.shift();
          budget -= d;
        } else {
          this.sprite.setPosition(this.sprite.x + (dx / d) * budget, this.sprite.y + (dy / d) * budget);
          budget = 0;
        }
      }
      if (!this.waypoints.length && this.arrive) {
        const a = this.arrive;
        this.arrive = null;
        this.setActivity(a.activity, a.facing);
      }
    }
    this.layout(dt, zoom);
  }

  private walkDir: string | null = null;
  private playWalk(dir: Facing) {
    const key = dir === "down" ? "down" : dir === "up" ? "up" : "side";
    this.sprite.setFlipX(dir === "right");
    if (this.walkDir !== key || !this.sprite.anims.isPlaying || !this.sprite.anims.currentAnim?.key.includes("walk")) {
      this.walkDir = key;
      this.sprite.play(`emp-${this.profile.id}-walk-${key}`, true);
    }
  }

  private layout(dt: number, zoom: number) {
    const x = this.sprite.x,
      y = this.sprite.y;
    this.sprite.setDepth(y);
    this.shadow.setPosition(x, y - 1).setDepth(y - 0.5);
    // Labels keep ~11-13 px on screen whatever the camera zoom.
    const k = Phaser.Math.Clamp(1 / zoom, 0.42, 1.1);
    const tagY = y - 25 - 10 * k;
    this.tag.setScale(k).setPosition(x, tagY).setDepth(100000 + y);
    const bh = this.bubbleText.height + 10;
    this.bubble.setScale(k).setPosition(x, tagY - 10 * k - 6 * k - (bh / 2) * k).setDepth(200000 + y);
    this.pulse += dt * 4;
    const g = this.ring;
    g.clear();
    if (this.selected) {
      const r = 9 + Math.sin(this.pulse) * 1.2;
      g.lineStyle(1.5, Phaser.Display.Color.HexStringToColor(this.profile.look.accent).color, 1);
      g.strokeEllipse(x, y - 1, r * 2, r * 0.8);
      g.fillStyle(0xffffff, 1);
      const ay = tagY - 11 * k + Math.sin(this.pulse * 1.5) * 1.5;
      g.fillTriangle(x - 3, ay - 4, x + 3, ay - 4, x, ay);
    }
    g.setDepth(y - 0.4);
  }

  setTimeScale(s: number) {
    this.sprite.anims.timeScale = s;
  }

  hitTest(wx: number, wy: number) {
    return Math.abs(wx - this.sprite.x) <= 8 && wy <= this.sprite.y + 1 && wy >= this.sprite.y - 24;
  }
}
