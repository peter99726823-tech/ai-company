/**
 * Serves the app's /api/* requests inside the browser, using the same server functions as the
 * Node version. Only the free paste mode exists here: there is no worker and no API key.
 */
import { getDb } from "./client";
import { getOfficeSnapshot } from "../src/server/services/office";
import { createTask, getTaskDetail, requestCancel, retryTask, getReport, TaskInputError } from "../src/server/tasks/service";
import { createMeeting, getMeeting, recentMeetings, decideMeeting, getManualPrompt, submitManualAnswer, meetingMinutes } from "../src/server/meetings/service";
import { getChat, sendChat } from "../src/server/chat/service";
import { actOnReport, type ReportAction } from "../src/server/reports/service";
import { getAutonomy, setAutonomy, listRoutines, createRoutine, updateRoutine, deleteRoutine, runRoutineNow, approveProposal, rejectProposal } from "../src/server/autonomy/service";
import { listTransactions, addTransaction, deleteTransaction } from "../src/server/finance/service";
import { createProject, updateProject, projectDetail } from "../src/server/projects/service";
import { toBackupJson, fromBackupJson } from "../src/server/backup";
import { listIdeas, createIdea, updateIdea, deleteIdea, validateIdea, meetIdea } from "../src/server/ideas/service";
import { exportDb, replaceDb } from "./client";

type Handler = (m: RegExpMatchArray, body: Record<string, unknown>, query: URLSearchParams) => unknown | Promise<unknown>;
const listeners = new Set<() => void>();
export const onChange = (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn));

export const LITE_HEALTH = {
  lite: true,
  db: { ok: true, error: null },
  ai: { keyConfigured: false, model: "claude.ai (붙여넣기)", verified: false, lastError: null, engineConnected: false, message: "링크 버전: 업무와 회의를 claude.ai 붙여넣기 방식으로 처리합니다. API 비용 없음." },
  worker: { running: false, message: "링크 버전에는 자동 실행기가 없습니다. 반복 업무는 이 페이지가 열려 있을 때 확인합니다." },
};

const GET: [RegExp, Handler][] = [
  [/^\/api\/office$/, () => getOfficeSnapshot()],
  [/^\/api\/health$/, () => LITE_HEALTH],
  [/^\/api\/meetings$/, () => ({ meetings: recentMeetings(getDb() as never, 20) })],
  [/^\/api\/meetings\/minutes$/, () => ({ minutes: meetingMinutes(getDb() as never) })],
  [/^\/api\/meetings\/([\w-]+)$/, (m) => getMeeting(getDb() as never, m[1]) ?? notFound("회의를 찾을 수 없습니다.")],
  [/^\/api\/tasks\/([\w-]+)$/, (m) => getTaskDetail(getDb() as never, m[1]) ?? notFound("업무를 찾을 수 없습니다.")],
  [/^\/api\/tasks\/([\w-]+)\/prompt$/, (m) => ({ prompt: getManualPrompt(getDb() as never, m[1]) })],
  [/^\/api\/reports\/([\w-]+)$/, (m) => getReport(getDb() as never, m[1]) ?? notFound("보고서를 찾을 수 없습니다.")],
  [/^\/api\/chat\/([\w-]+)$/, (m, _b, q) => getChat(getDb() as never, m[1], q.get("projectId") || null)],
  [/^\/api\/settings\/autonomy$/, () => getAutonomy(getDb() as never)],
  [/^\/api\/routines$/, () => ({ routines: listRoutines(getDb() as never) })],
  [/^\/api\/finance$/, (_m, _b, q) => listTransactions(getDb() as never, q.get("month"))],
  [/^\/api\/projects\/([\w-]+)$/, (m) => projectDetail(getDb() as never, m[1]) ?? notFound("프로젝트를 찾을 수 없습니다.")],
  [/^\/api\/backup$/, () => toBackupJson(exportDb())],
  [/^\/api\/ideas$/, () => ({ ideas: listIdeas(getDb() as never) })],
];

const POST: [RegExp, Handler][] = [
  [/^\/api\/settings\/autonomy$/, (_m, b) => setAutonomy(getDb() as never, b)],
  [/^\/api\/ideas$/, (_m, b) => createIdea(getDb() as never, b as never)],
  [/^\/api\/ideas\/([\w-]+)\/update$/, (m, b) => updateIdea(getDb() as never, m[1], b as never)],
  [/^\/api\/ideas\/([\w-]+)\/delete$/, (m) => deleteIdea(getDb() as never, m[1])],
  [/^\/api\/ideas\/([\w-]+)\/validate$/, (m) => validateIdea(getDb() as never, m[1], "manual")],
  [/^\/api\/ideas\/([\w-]+)\/meeting$/, (m) => meetIdea(getDb() as never, m[1], "manual")],
  [/^\/api\/routines$/, (_m, b) => createRoutine(getDb() as never, { ...(b as never), executionMode: "manual" })],
  [/^\/api\/routines\/([\w-]+)\/run$/, (m) => runRoutineNow(getDb() as never, m[1], false)],
  [/^\/api\/routines\/([\w-]+)\/update$/, (m, b) => updateRoutine(getDb() as never, m[1], { enabled: b.enabled as boolean | undefined })],
  [/^\/api\/routines\/([\w-]+)\/delete$/, (m) => deleteRoutine(getDb() as never, m[1])],
  [/^\/api\/tasks\/([\w-]+)\/approve$/, (m) => approveProposal(getDb() as never, m[1], "manual")],
  [/^\/api\/tasks\/([\w-]+)\/reject$/, (m) => rejectProposal(getDb() as never, m[1])],
  [/^\/api\/finance$/, (_m, b) => addTransaction(getDb() as never, b as never)],
  [/^\/api\/finance\/([\w-]+)\/delete$/, (m) => deleteTransaction(getDb() as never, m[1])],
  [/^\/api\/projects$/, (_m, b) => createProject(getDb() as never, b as never)],
  [/^\/api\/projects\/([\w-]+)$/, (m, b) => updateProject(getDb() as never, m[1], b as never)],
  [/^\/api\/backup\/restore$/, async (_m, b) => (await replaceDb(fromBackupJson(b)), { ok: true })],
  [/^\/api\/chat\/([\w-]+)$/, (m, b) => sendChat(getDb() as never, { employeeId: m[1], projectId: (b.projectId as string) ?? null, text: String(b.text ?? ""), executionMode: "manual", attachments: b.attachments })],
  [
    /^\/api\/reports\/([\w-]+)\/action$/,
    (m, b) =>
      actOnReport(getDb() as never, m[1], {
        action: String(b.action) as ReportAction,
        note: b.note ? String(b.note) : "",
        targetEmployeeId: b.targetEmployeeId ? String(b.targetEmployeeId) : undefined,
        executionMode: "manual",
        project: (b.project as { id: string; stage?: string; nextPlan?: string }) ?? undefined,
      }),
  ],
  [
    /^\/api\/tasks$/,
    (_m, b) => ({
      task: createTask(getDb() as never, { employeeId: String(b.employeeId ?? ""), instruction: String(b.instruction ?? ""), type: b.type as string, projectId: (b.projectId as string) ?? null, executionMode: "manual", attachments: b.attachments }),
    }),
  ],
  [/^\/api\/tasks\/([\w-]+)\/cancel$/, (m) => conflictIf(requestCancel(getDb() as never, m[1]))],
  [/^\/api\/tasks\/([\w-]+)\/retry$/, (m) => conflictIf(retryTask(getDb() as never, m[1]))],
  [/^\/api\/tasks\/([\w-]+)\/submit$/, (m, b) => ({ reportId: submitManualAnswer(getDb() as never, m[1], String(b.text ?? "")) })],
  [
    /^\/api\/meetings$/,
    (_m, b) =>
      createMeeting(getDb() as never, {
        topic: String(b.topic ?? ""),
        participantIds: Array.isArray(b.participantIds) ? (b.participantIds as unknown[]).map(String) : [],
        projectId: (b.projectId as string) ?? null,
        executionMode: "manual",
        attachments: b.attachments,
      }),
  ],
  [
    /^\/api\/meetings\/([\w-]+)\/decide$/,
    (m, b) =>
      decideMeeting(getDb() as never, m[1], {
        option: String(b.option ?? ""),
        note: b.note ? String(b.note) : "",
        followUps: Array.isArray(b.followUps) ? (b.followUps as { employeeId: unknown; instruction: unknown }[]).map((f) => ({ employeeId: String(f.employeeId), instruction: String(f.instruction) })) : [],
        executionMode: "manual",
      }),
  ],
];

class HttpError extends Error {
  constructor(
    public status: number,
    msg: string,
    public body?: unknown,
  ) {
    super(msg);
  }
}
function notFound(msg: string): never {
  throw new HttpError(404, msg);
}
function conflictIf(r: { ok: boolean; message: string }) {
  if (!r.ok) throw new HttpError(409, r.message, r);
  return r;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Tell the app something changed outside a request (e.g. the scheduler created work). */
export function notifyChange() {
  listeners.forEach((fn) => fn());
}

export function installRouter() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    const path = url.startsWith("/api/") ? url.split("?")[0] : null;
    const query = new URLSearchParams(url.split("?")[1] ?? "");
    if (!path) return original(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    const table = method === "POST" ? POST : GET;
    for (const [re, h] of table) {
      const m = path.match(re);
      if (!m) continue;
      try {
        const body = init?.body ? JSON.parse(String(init.body)) : {};
        const out = await h(m, body, query);
        if (method === "POST") listeners.forEach((fn) => fn());
        return json(method === "POST" && /^\/api\/(tasks|meetings|routines|finance|projects|ideas|chat\/[\w-]+)$/.test(path) ? 201 : 200, out);
      } catch (e) {
        if (e instanceof HttpError) return json(e.status, e.body ?? { error: e.message });
        if (e instanceof TaskInputError || (e instanceof Error && /백업 파일/.test(e.message))) return json(400, { error: e.message });
        return json(500, { error: (e as Error).message });
      }
    }
    return json(404, { error: `링크 버전에서 지원하지 않는 기능입니다: ${method} ${path}` });
  };
}
