"use client";

import { create } from "zustand";
import type { ActorSnapshot } from "@/game/bridge";
import type { TaskEventRow } from "@/server/db/schema";

export interface MovementEntry {
  at: number;
  id: string;
  text: string;
}

export interface Toast {
  id: number;
  tone: "ok" | "bad" | "info";
  text: string;
  reportId?: string | null;
  meetingId?: string | null;
  chat?: boolean;
  employeeId?: string | null;
}

export type GameSpeed = 0.5 | 1 | 2 | 4;

interface OfficeState {
  ready: boolean;
  selectedId: string | null;
  followingId: string | null;
  speed: GameSpeed;
  actors: Record<string, ActorSnapshot>;
  movements: MovementEntry[];
  liveEvents: TaskEventRow[];
  reportId: string | null;
  meetingId: string | null;
  meetingDialog: boolean;
  manualTaskId: string | null;
  chatEmployeeId: string | null;
  toasts: Toast[];
  setReady: () => void;
  setSelected: (id: string | null) => void;
  setFollowing: (id: string | null) => void;
  setSpeed: (s: GameSpeed) => void;
  upsertActor: (a: ActorSnapshot) => void;
  pushMovement: (m: Omit<MovementEntry, "at">) => void;
  pushEvent: (e: TaskEventRow) => void;
  openReport: (id: string | null) => void;
  openMeeting: (id: string | null) => void;
  setMeetingDialog: (v: boolean) => void;
  openManual: (taskId: string | null) => void;
  openChat: (employeeId: string | null) => void;
  toast: (t: Omit<Toast, "id">) => void;
  dismissToast: (id: number) => void;
}

let toastSeq = 0;

export const useOffice = create<OfficeState>((set) => ({
  ready: false,
  selectedId: null,
  followingId: null,
  speed: 1,
  actors: {},
  movements: [],
  liveEvents: [],
  reportId: null,
  meetingId: null,
  meetingDialog: false,
  manualTaskId: null,
  chatEmployeeId: null,
  toasts: [],
  setReady: () => set({ ready: true }),
  setSelected: (id) => set({ selectedId: id }),
  setFollowing: (id) => set({ followingId: id }),
  setSpeed: (speed) => set({ speed }),
  upsertActor: (a) => set((s) => ({ actors: { ...s.actors, [a.id]: a } })),
  pushMovement: (m) => set((s) => ({ movements: [{ ...m, at: Date.now() }, ...s.movements].slice(0, 60) })),
  pushEvent: (e) =>
    set((s) => {
      const toasts = [...s.toasts];
      // 대표 알림: completion and failure are announced; everything else goes to the log only.
      if (e.type === "TASK_COMPLETED") {
        const data = e.data ? (JSON.parse(e.data) as { reportId?: string; meetingId?: string | null; conversationId?: string }) : {};
        toasts.push({
          id: ++toastSeq,
          tone: "ok",
          text: e.message,
          reportId: data.meetingId ? null : (data.reportId ?? null),
          meetingId: data.meetingId ?? null,
          chat: !!data.conversationId,
          employeeId: e.employeeId,
        });
      } else if (e.type === "TASK_FAILED") {
        toasts.push({ id: ++toastSeq, tone: "bad", text: e.message, employeeId: e.employeeId });
      }
      return { liveEvents: [e, ...s.liveEvents.filter((x) => x.id !== e.id)].slice(0, 80), toasts: toasts.slice(-4) };
    }),
  openReport: (reportId) => set({ reportId }),
  openMeeting: (meetingId) => set({ meetingId }),
  setMeetingDialog: (meetingDialog) => set({ meetingDialog }),
  openManual: (manualTaskId) => set({ manualTaskId }),
  openChat: (chatEmployeeId) => set({ chatEmployeeId }),
  toast: (t) => set((s) => ({ toasts: [...s.toasts, { ...t, id: ++toastSeq }].slice(-4) })),
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
