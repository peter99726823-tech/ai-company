/**
 * Shared by both execution modes:
 * - buildPrompts: what the AI is asked (identical for the worker and for claude.ai paste)
 * - finalizeTask: turns an AI answer into a saved report (and meeting record) and completes the task
 */
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import type { DB } from "../db/client";
import * as s from "../db/schema";
import { transition, recordEvent, TaskInputError } from "./service";
import type { TaskStatus } from "@/domain/types";
import { TASK_TYPE_BY_ID } from "@/domain/taskTypes";
import { meetingSystemPrompt, meetingUserPrompt, parseMeeting, MeetingFormatError } from "../meetings/format";
import { proposeFromReport } from "../autonomy/service";
import { transactionsForPrompt } from "../finance/service";
import { attachmentsForPrompt, parseAttachments } from "@/domain/attachments";

type Task = typeof s.tasks.$inferSelect;

function projectOf(db: DB, id: string | null) {
  return id ? (db.select().from(s.projects).where(eq(s.projects.id, id)).get() ?? null) : null;
}

export function meetingParticipants(db: DB, meetingId: string) {
  return db.select().from(s.meetingParticipants).where(eq(s.meetingParticipants.meetingId, meetingId)).orderBy(asc(s.meetingParticipants.order)).all();
}

export function buildPrompts(db: DB, task: Task, webSearch: boolean): { system: string; user: string } {
  const company = db.select().from(s.company).get();
  const project = projectOf(db, task.projectId);
  if (task.type === "MEETING" && task.meetingId) {
    const meeting = db.select().from(s.meetings).where(eq(s.meetings.id, task.meetingId)).get();
    if (!meeting) throw new TaskInputError("회의 정보를 찾을 수 없습니다.");
    const att = attachmentsForPrompt(parseAttachments(meeting.attachments), "회의 참고 자료 (대표 첨부)");
    return {
      system: meetingSystemPrompt(),
      user:
        meetingUserPrompt({
        topic: meeting.topic,
        participantIds: meetingParticipants(db, meeting.id).map((p) => p.employeeId),
        project,
        companyName: company?.name,
        webSearch,
      }) + (att ? `\n\n${att}` : ""),
    };
  }
  const system = db
    .select({ p: s.employeePrompts.systemPrompt })
    .from(s.employeePrompts)
    .where(and(eq(s.employeePrompts.employeeId, task.employeeId), eq(s.employeePrompts.active, true)))
    .orderBy(sql`${s.employeePrompts.version} desc`)
    .get()?.p;
  if (!system) throw new TaskInputError("이 직원의 시스템 프롬프트가 DB에 없습니다.");
  if (task.type === "CHAT" && task.conversationId) {
    // Conversation: same persona, but a reply instead of a report. Recent history is included.
    const history = db
      .select()
      .from(s.messages)
      .where(eq(s.messages.conversationId, task.conversationId))
      .orderBy(asc(s.messages.createdAt))
      .all()
      .slice(-12);
    const name = EMPLOYEE_BY_ID[task.employeeId]?.name ?? "직원";
    const lines = history.map((m) => `${m.role === "ceo" ? "대표" : name}: ${m.content}`).join("\n\n");
    const chatSystem = `${system.split("보고서 형식")[0].trim()}\n\n지금은 대표와 1:1로 대화 중입니다. 보고서 형식을 쓰지 말고, 당신의 전문 분야 관점에서 짧고 분명하게 답하세요. 모르는 것은 모른다고 하고, 더 깊은 분석이 필요하면 업무로 지시해 달라고 제안하세요.`;
    const ctx = project ? `# 이 대화의 프로젝트\n${project.name}: ${project.description} (단계: ${project.stage}, 목표: ${project.goal})\n\n` : "";
    let att = attachmentsForPrompt(parseAttachments(task.attachments), "대표가 이번 메시지에 첨부한 자료");
    if (!att) {
      // Follow-up questions about material attached earlier in this conversation keep that material.
      const earlier = db
        .select({ a: s.tasks.attachments })
        .from(s.tasks)
        .where(and(eq(s.tasks.conversationId, task.conversationId), sql`${s.tasks.attachments} is not null`))
        .orderBy(desc(s.tasks.createdAt))
        .get();
      if (earlier?.a) att = attachmentsForPrompt(parseAttachments(earlier.a), "이 대화에서 대표가 앞서 첨부한 자료");
    }
    return { system: chatSystem, user: `${ctx}# 지금까지의 대화\n${lines}\n\n${att ? `${att}\n\n` : ""}# 할 일\n대표의 마지막 말에 ${name}으로서 답하세요. 답변만 쓰세요.` };
  }
  const def = TASK_TYPE_BY_ID[task.type] ?? TASK_TYPE_BY_ID.GENERAL;
  const parts: string[] = [];
  parts.push(`# 회사\n${company?.name ?? ""} — ${company?.mission ?? ""}`);
  if (project) {
    parts.push(
      `# 관련 프로젝트 (대표가 입력한 정보, "미확인"은 아직 모르는 값)\n- 이름: ${project.name}\n- 설명: ${project.description}\n- 목표: ${project.goal}\n- 현재 단계: ${project.stage}\n- 다음 계획: ${project.nextPlan}`,
    );
  }
  parts.push(`# 업무 유형\n${def.label}: ${def.guide}`);
  if (task.type === "TRANSACTIONS") {
    parts.push(`# 앱에 입력된 거래내역 (대표가 입력한 실제 데이터와 시뮬레이션 데이터, 구분 열 참고)\n${transactionsForPrompt(db, task.projectId)}`);
  }
  parts.push(
    webSearch
      ? "# 도구\n웹 검색 도구를 쓸 수 있습니다. 최신 가격·경쟁사·시장 정보는 검색해서 확인하고, 참고한 자료에 실제 URL을 적으세요."
      : `# 도구\n이번 업무에서는 웹 검색을 쓸 수 없습니다. 최신 정보는 조사하지 못했다고 밝히고, '참고한 자료'에는 "웹 검색 미사용"이라고 적은 뒤 대표가 확인해야 할 항목을 쓰세요.${def.wantsWeb ? " 이 업무는 최신 시장 정보가 중요하므로 그 한계를 요약에도 밝히세요." : ""}`,
  );
  if (task.parentTaskId) {
    // Follow-up work (수정 요청, 추가 분석, 전달, 회의 후속): give the earlier result as input.
    const prev = db.select().from(s.reports).where(eq(s.reports.taskId, task.parentTaskId)).orderBy(desc(s.reports.createdAt)).get();
    if (prev) {
      const author = EMPLOYEE_BY_ID[prev.employeeId]?.name ?? prev.employeeId;
      const body = prev.body.length > 12000 ? `${prev.body.slice(0, 12000)}\n…(이하 생략)` : prev.body;
      parts.push(`# 이전 결과물 (${author} 작성, 이번 업무의 입력 자료)\n${body}`);
    }
  }
  parts.push(`# 대표의 지시\n${task.instruction}`);
  const att = attachmentsForPrompt(parseAttachments(task.attachments));
  if (att) parts.push(att);
  return { system, user: parts.join("\n\n") };
}

/** Split a markdown report into its structured fields. */
export function parseReport(md: string) {
  const sections: Record<string, string> = {};
  let cur: string | null = null;
  for (const line of md.split("\n")) {
    const m = /^##\s+(.+)$/.exec(line.trim());
    if (m) {
      cur = m[1].trim();
      sections[cur] = "";
    } else if (cur) sections[cur] += line + "\n";
  }
  const bullets = (k: string) =>
    (sections[k] ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[-*]\s+/.test(l))
      .map((l) => l.replace(/^[-*]\s+/, ""))
      .filter((l) => l && l !== "해당 없음");
  return {
    summary: (sections["요약"] ?? sections["회의 요약"] ?? "").trim(),
    facts: bullets("확인된 사실"),
    assumptions: bullets("가정과 불확실성"),
    nextTasks: bullets("다음 추천 업무").concat(bullets("후속 업무 제안")),
  };
}

/**
 * Save the AI answer and mark the task COMPLETED.
 * For meetings the answer must contain every participant and the CEO synthesis; otherwise
 * MeetingFormatError is thrown and nothing is saved.
 */
export function finalizeTask(
  db: DB,
  task: Task,
  text: string,
  opts: { from: TaskStatus[]; leaseOwner?: string; sources?: { title: string; url: string }[]; truncated?: boolean; via: "api" | "manual" | "claude"; usageNote?: string },
): string {
  if (task.type === "CHAT" && task.conversationId) {
    const msgId = `msg_${randomUUID().slice(0, 8)}`;
    db.transaction((tx) => {
      tx.insert(s.messages).values({ id: msgId, conversationId: task.conversationId!, role: "employee", content: text.trim(), taskId: task.id }).run();
      const moved = transition(tx as unknown as DB, task.id, {
        from: opts.from,
        leaseOwner: opts.leaseOwner,
        patch: { status: "COMPLETED", progress: 100, finishedAt: Date.now(), statusMessage: "답변 완료", leaseOwner: null, leaseUntil: null },
        event: { type: "TASK_COMPLETED", message: `대화 답변${opts.via === "manual" ? " (claude.ai 붙여넣기)" : opts.via === "claude" ? " (Claude 자동)" : ""}${opts.usageNote ? ` · ${opts.usageNote}` : ""}`, data: { messageId: msgId, conversationId: task.conversationId } },
      });
      if (!moved) throw new TaskInputError("업무 상태가 바뀌어 저장하지 않았습니다 (이미 끝났거나 취소됨).");
    });
    return msgId;
  }
  const meeting = task.type === "MEETING" && task.meetingId ? db.select().from(s.meetings).where(eq(s.meetings.id, task.meetingId)).get() : null;
  const participants = meeting ? meetingParticipants(db, meeting.id) : [];
  const parsedMeeting = meeting ? parseMeeting(text, participants.map((p) => p.employeeId)) : null;
  const parsed = parseReport(parsedMeeting ? parsedMeeting.summary : text);
  const reportId = `rep_${randomUUID().slice(0, 8)}`;
  const viaNote =
    opts.via === "manual"
      ? "\n\n> 이 결과는 대표가 claude.ai에서 받은 답변을 붙여넣어 저장한 것입니다."
      : opts.via === "claude"
        ? "\n\n> 이 결과는 링크 버전의 Claude 자동(대표의 claude.ai 계정)으로 작성해 저장한 것입니다."
        : "";
  const body = (opts.truncated ? `${text}\n\n> ⚠️ 응답이 출력 길이 한도에 걸려 여기서 잘렸습니다.` : text) + viaNote;

  db.transaction((tx) => {
    tx.insert(s.reports)
      .values({
        id: reportId,
        taskId: task.id,
        meetingId: meeting?.id ?? null,
        employeeId: task.employeeId,
        projectId: task.projectId,
        title: task.title,
        body: parsedMeeting ? parsedMeeting.summary + viaNote : body,
        facts: JSON.stringify(parsed.facts),
        assumptions: JSON.stringify(parsed.assumptions),
        sources: JSON.stringify(opts.sources ?? []),
        nextTasks: JSON.stringify(parsedMeeting ? parsedMeeting.followUps : parsed.nextTasks),
      })
      .run();
    if (meeting && parsedMeeting) {
      for (const p of participants) {
        const st = parsedMeeting.statements.find((x) => x.employeeId === p.employeeId);
        tx.update(s.meetingParticipants).set({ statement: st?.text ?? null }).where(eq(s.meetingParticipants.id, p.id)).run();
      }
      tx.update(s.meetings).set({ status: "COMPLETED", endedAt: Date.now(), summaryReportId: reportId }).where(eq(s.meetings.id, meeting.id)).run();
    }
    const moved = transition(tx as unknown as DB, task.id, {
      from: opts.from,
      leaseOwner: opts.leaseOwner,
      patch: {
        status: "COMPLETED",
        progress: 100,
        finishedAt: Date.now(),
        statusMessage: opts.truncated ? "완료 (일부 잘림)" : meeting ? "회의록 제출 완료" : "보고서 제출 완료",
        leaseOwner: null,
        leaseUntil: null,
      },
      event: {
        type: "TASK_COMPLETED",
        message: `${meeting ? "회의록" : "보고서"} 제출 완료${opts.via === "manual" ? " (claude.ai 답변 붙여넣기)" : opts.via === "claude" ? " (Claude 자동)" : ""}${opts.truncated ? " · 일부 잘림" : ""}${opts.usageNote ? ` · ${opts.usageNote}` : ""}`,
        data: { reportId, meetingId: meeting?.id ?? null },
      },
    });
    // Throwing inside the transaction rolls back the report and meeting writes too.
    if (!moved) throw new TaskInputError("업무 상태가 바뀌어 저장하지 않았습니다 (이미 끝났거나 취소됨).");
    if (meeting) recordEvent(tx as unknown as DB, { type: "MEETING_ENDED", meetingId: meeting.id, employeeId: task.employeeId, message: `회의 종료: ${meeting.topic.slice(0, 40)}` });
  });
  // 반자동/자동 모드: the report's recommended next tasks become proposals for the CEO.
  if (!meeting) proposeFromReport(db, task.id, parsed.nextTasks);
  return reportId;
}

export { MeetingFormatError };
