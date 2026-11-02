"use client";

import { create } from "zustand";
import type { ActorSnapshot } from "@/game/bridge";

export interface MovementEntry {
  at: number;
  id: string;
  text: string;
}

export type GameSpeed = 0.5 | 1 | 2 | 4;

interface OfficeState {
  ready: boolean;
  selectedId: string | null;
  followingId: string | null;
  speed: GameSpeed;
  actors: Record<string, ActorSnapshot>;
  movements: MovementEntry[];
  setReady: () => void;
  setSelected: (id: string | null) => void;
  setFollowing: (id: string | null) => void;
  setSpeed: (s: GameSpeed) => void;
  upsertActor: (a: ActorSnapshot) => void;
  pushMovement: (m: Omit<MovementEntry, "at">) => void;
}

export const useOffice = create<OfficeState>((set) => ({
  ready: false,
  selectedId: null,
  followingId: null,
  speed: 1,
  actors: {},
  movements: [],
  setReady: () => set({ ready: true }),
  setSelected: (id) => set({ selectedId: id }),
  setFollowing: (id) => set({ followingId: id }),
  setSpeed: (speed) => set({ speed }),
  upsertActor: (a) => set((s) => ({ actors: { ...s.actors, [a.id]: a } })),
  pushMovement: (m) => set((s) => ({ movements: [{ ...m, at: Date.now() }, ...s.movements].slice(0, 60) })),
}));
