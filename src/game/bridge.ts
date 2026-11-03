/**
 * Typed message bus between React (UI, server data) and Phaser (rendering).
 * Phaser never calls the server; React never touches sprites.
 */
import type { Activity } from "@/domain/types";

export type Destination = "desk" | "meeting" | "lounge" | "report" | "stay";

export interface ActorCommand {
  id: string;
  /** Where to walk before playing the activity. */
  go: Destination;
  activity: Activity;
  /** Speech bubble text; null clears it. */
  bubble?: string | null;
  /**
   * "task": driven by a real server task (PHASE 2) — ambient idling is suspended.
   * "preview": developer animation preview — clearly not real work.
   */
  source: "task" | "preview";
}

export interface ActorSnapshot {
  id: string;
  activity: Activity;
  roomName: string;
  moving: boolean;
  bubble: string | null;
  mode: "ambient" | "task" | "preview";
}

type ToGame = {
  select: string | null;
  fit: void;
  follow: string | null;
  zoomBy: number;
  speed: number;
  command: ActorCommand;
  release: string; // return an employee to ambient idling
  lighting: "auto" | "day" | "night";
};

type FromGame = {
  ready: void;
  selected: string | null;
  actor: ActorSnapshot;
  movement: { id: string; text: string };
  following: string | null;
};

type Handler<T> = (payload: T) => void;

class Bus<M extends Record<string, unknown>> {
  private h = new Map<keyof M, Set<Handler<never>>>();
  on<K extends keyof M>(k: K, fn: Handler<M[K]>): () => void {
    if (!this.h.has(k)) this.h.set(k, new Set());
    this.h.get(k)!.add(fn as Handler<never>);
    return () => this.h.get(k)!.delete(fn as Handler<never>);
  }
  emit<K extends keyof M>(k: K, payload: M[K]) {
    this.h.get(k)?.forEach((fn) => (fn as Handler<M[K]>)(payload));
  }
  clear() {
    this.h.clear();
  }
}

export const toGame = new Bus<ToGame>();
export const fromGame = new Bus<FromGame>();
