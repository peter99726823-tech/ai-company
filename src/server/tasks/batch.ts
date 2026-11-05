/**
 * Batch execution: several follow-up tasks done in ONE AI answer (one Claude call, or one paste),
 * followed by the CEO Advisor's synthesis of the results.
 *
 * The answer is split by `=== 업무: <taskId> | 이름 ===` markers. Every task must have its section;
 * if any is missing nothing is saved (no half-finished batches, no invented sections).
 */
import { eq } from "drizzle-orm";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { COMPANY_RULES, ROLE_PROMPTS } from "../ai/prompts";
import { buildPrompts, finalizeTask } from "./complete";
import { createTask, getTask, TaskInputError } from "./service";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { projectMemory } from "../work/service";

export const TASK_MARK = "=== 업무:";
export const BATCH_SUMMARY_MARK = "=== 종합: CEO Advisor ===";
const MAX_TASKS = 8;

function loadTasks(db: DB, taskIds: string[]) {
  const ids = [...new Set(taskIds)].slice(0, MAX_TASKS);
  if (!ids.length) throw new TaskInputError("실행할 업무가 없습니다.");
  return ids.map((id) => {
    const t = getTask(db, id);
    if (!t) throw new TaskInputError(`업무를 찾을 수 없습니다: ${id}`);
    if (t.executionMode !== "manual") throw new TaskInputError(`붙여넣기 방식 업무만 한 번에 실행할 수 있습니다: ${t.title}`);
    if (t.status !== "QUEUED") throw new TaskInputError(`이미 끝났거나 취소된 업무가 있습니다: ${t.title}`);
    if (t.type === "MEETING" || t.type === "CHAT") throw new TaskInputError("회의와 대화는 한 번에 실행할 수 없습니다.");
    return t;
  });
}

/** One prompt for all the tasks: shared rules once, then each employee's role, inputs and instruction. */
export function batchPrompt(db: DB, taskIds: string[]): string {
  const tasks = loadTasks(db, taskIds);
  const rules = COMPANY_RULES;
  // Project memory is the same for every task in a batch: send it once, not per task.
  const shared = projectMemory(db, tasks[0].projectId, { excludeTaskId: tasks[0].parentTaskId ?? undefined });
  const blocks = tasks.map((t, i) => {
    const e = EMPLOYEE_BY_ID[t.employeeId];
    const own = projectMemory(db, t.projectId, { excludeTaskId: t.parentTaskId ?? undefined });
    const user = buildPrompts(db, t, false).user.replace(own ? `${own}\n\n` : "\u0000", "");
    return `## 업무 ${i + 1} — ${t.id} | ${e.name} (${e.title})
### 담당자 역할
${ROLE_PROMPTS[t.employeeId] ?? ""}
### 업무 자료와 지시
${user}`;
  });
  const header = tasks.map((t) => `${TASK_MARK} ${t.id} | ${EMPLOYEE_BY_ID[t.employeeId].name} ===`).join("\n(보고서)\n");
  return `당신은 1인 AI 프로덕트 스튜디오의 여러 AI 직원이 각자 맡은 업무를 한 번에 수행하는 것을 대신 작성합니다. 각 업무는 담당 직원의 역할과 관점으로, 서로의 결과를 참고해 일관되게 작성합니다. 마지막에 CEO Advisor 한결이 전체 결과를 종합합니다.

# 공통 규칙 (모든 업무에 적용)
${rules}

${shared ? `${shared}\n\n` : ""}# 업무 목록 (${tasks.length}건, 이 순서대로 작성)
${blocks.join("\n\n")}

# 출력 형식 (반드시 이 구분선을 그대로 쓰세요. 구분선 줄은 수정하지 마세요)
${header}
(보고서)
${BATCH_SUMMARY_MARK}
## 실행 결과 요약
(각 업무에서 나온 핵심 결과물 한두 줄씩)
## 바로 쓸 수 있는 결과물
(대표가 지금 복사해 쓸 수 있는 형태로 정리: 문서 초안, 표, 지시문 등)
## 남은 확인 사항
- (대표가 직접 확인해야 할 것)
## 다음 행동
- (대표가 오늘 할 일 순서대로)

각 "(보고서)" 자리에는 공통 규칙의 보고서 형식(## 요약 … ## 다음 추천 업무)을 그대로 따른 그 직원의 보고서를 씁니다.`;
}

export interface ParsedBatch {
  sections: { taskId: string; text: string }[];
  summary: string;
}

/** Split a batch answer. Throws (and nothing is saved) if any task or the synthesis is missing. */
export function parseBatch(text: string, taskIds: string[]): ParsedBatch {
  const t = text.replace(/\r\n/g, "\n");
  const sumIdx = t.search(/^===\s*종합/m);
  if (sumIdx < 0) throw new TaskInputError("'=== 종합: CEO Advisor ===' 구분선이 없습니다. 답변 전체를 붙여넣었는지 확인하세요.");
  const head = t.slice(0, sumIdx);
  const summary = t.slice(sumIdx).replace(/^===\s*종합[^\n]*\n?/, "").trim();
  const re = /^===\s*업무:\s*(task_[\w-]+)[^\n]*$/gm;
  const marks: { id: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) marks.push({ id: m[1], start: m.index, end: m.index + m[0].length });
  const sections = marks
    .map((mk, i) => ({ taskId: mk.id, text: head.slice(mk.end, marks[i + 1]?.start ?? head.length).trim() }))
    .filter((x) => taskIds.includes(x.taskId));
  const missing = taskIds.filter((id) => !sections.some((x) => x.taskId === id && x.text.length >= 40));
  if (missing.length) throw new TaskInputError(`다음 업무의 보고서가 답변에 없거나 너무 짧습니다: ${missing.join(", ")}. 구분선(=== 업무: ...)이 그대로 있는지 확인하세요.`);
  if (summary.length < 40) throw new TaskInputError("CEO Advisor 종합 내용이 비어 있습니다.");
  return { sections, summary };
}

/**
 * Save every task's report and the synthesis (as a CEO Advisor report).
 * Validation happens before anything is written.
 */
export function submitBatch(db: DB, taskIds: string[], text: string, meetingId?: string | null, via: "manual" | "claude" = "manual") {
  const tasks = loadTasks(db, taskIds);
  const ids = tasks.map((t) => t.id);
  const parsed = parseBatch(text, ids);
  const reports: string[] = [];
  for (const t of tasks) {
    const body = parsed.sections.find((x) => x.taskId === t.id)!.text;
    reports.push(finalizeTask(db, t, body, { from: ["QUEUED"], via }));
  }
  // The synthesis becomes its own report from the CEO Advisor, linked to the first task.
  const meeting = meetingId ? db.select().from(s.meetings).where(eq(s.meetings.id, meetingId)).get() : null;
  const topic = meeting ? meeting.topic.trim().split("\n")[0].replace(/^#+\s*/, "").slice(0, 50) : tasks[0].title;
  const synth = createTask(db, {
    employeeId: "ceo-advisor",
    instruction: `실행 결과 종합: ${topic}\n\n(후속 업무 ${tasks.length}건의 결과를 한결이 종합)`,
    projectId: tasks[0].projectId,
    parentTaskId: tasks[0].parentTaskId,
    executionMode: "manual",
    source: "batch",
  });
  const names = tasks.map((t) => `- ${EMPLOYEE_BY_ID[t.employeeId]?.name}: ${t.title}`).join("\n");
  const synthBody = `## 요약\n후속 업무 ${tasks.length}건을 한 번에 실행한 결과를 종합했습니다.\n\n${parsed.summary}\n\n## 수행한 작업\n${names}`;
  const synthReportId = finalizeTask(db, getTask(db, synth.id)!, synthBody, { from: ["QUEUED"], via });
  if (meeting?.decision) {
    const d = JSON.parse(meeting.decision) as Record<string, unknown>;
    db.update(s.meetings)
      .set({ decision: JSON.stringify({ ...d, followUpTaskIds: ids, synthesisReportId: synthReportId }) })
      .where(eq(s.meetings.id, meeting.id))
      .run();
  }
  return { reports, synthesisReportId: synthReportId, synthesisTaskId: synth.id };
}
