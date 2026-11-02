/**
 * Shared domain types. Imported by the server (DB, orchestrator) and the client (UI, game).
 * Keep this file free of runtime dependencies.
 */

/** Real task lifecycle. Owned by the server; the client only displays it. */
export const TASK_STATUSES = [
  "QUEUED",
  "PLANNING",
  "RUNNING",
  "WAITING_APPROVAL",
  "COMPLETED",
  "FAILED",
  "CANCELED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  QUEUED: "대기",
  PLANNING: "계획 수립",
  RUNNING: "실제 실행 중",
  WAITING_APPROVAL: "대표 승인 대기",
  COMPLETED: "완료",
  FAILED: "실패",
  CANCELED: "취소",
};

/** Server event types streamed to the client (SSE in PHASE 2). */
export const EVENT_TYPES = [
  "TASK_CREATED",
  "TASK_ASSIGNED",
  "TASK_STARTED",
  "TASK_PROGRESS",
  "TASK_TOOL_STARTED",
  "TASK_TOOL_COMPLETED",
  "TASK_APPROVAL_REQUESTED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELED",
  "MEETING_STARTED",
  "MEETING_ENDED",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/**
 * What a character is visibly doing. This is the visual layer only:
 * an animation finishing never means a task finished.
 */
export const ACTIVITIES = [
  "idle",
  "walk",
  "working",
  "thinking",
  "meeting",
  "reporting",
  "resting",
  "error",
  "waiting",
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_LABEL: Record<Activity, string> = {
  idle: "대기",
  walk: "이동 중",
  working: "작업 중",
  thinking: "생각 중",
  meeting: "회의 중",
  reporting: "보고 중",
  resting: "휴식 중",
  error: "오류",
  waiting: "승인 대기",
};

export type RoomId =
  | "ceo"
  | "strategy"
  | "research"
  | "dev"
  | "salesMarketing"
  | "meeting"
  | "financeLegal"
  | "ops"
  | "lounge";

export type HairStyle =
  | "short"
  | "long"
  | "ponytail"
  | "spiky"
  | "bob"
  | "bun"
  | "sidePart"
  | "curly"
  | "buzz";

export type Accessory = "tie" | "glasses" | "headset" | "beret" | "visor" | "bowtie" | "cap" | "scarf" | "none";

export interface EmployeeLook {
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  shirt: string;
  pants: string;
  accessory: Accessory;
  accent: string; // department accent color, used for name tag and highlights
}

export interface EmployeeProfile {
  id: string;
  name: string;
  title: string;
  titleKo: string;
  room: RoomId;
  deskId: string;
  command: string;
  expertise: string[];
  look: EmployeeLook;
}

export interface ProjectSeed {
  id: string;
  name: string;
  description: string;
  goal: string;
  stage: string;
  ownerId: string | null;
  nextPlan: string;
}
