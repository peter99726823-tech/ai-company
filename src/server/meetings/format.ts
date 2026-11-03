/**
 * Meeting prompt and answer format. Pure functions (no DB) so they can be unit-tested.
 *
 * A meeting is one AI response in which the model speaks for each participating department
 * in order, each seeing what the previous ones said, followed by the CEO Advisor's synthesis.
 * The same prompt is used by the worker (API mode) and pasted into claude.ai (manual mode).
 */
import { EMPLOYEE_BY_ID, EMPLOYEES } from "@/domain/employees";
import { ROLE_PROMPTS, COMPANY_RULES } from "../ai/prompts";

export const DEPT_MARK = "=== 부서:";
export const SUMMARY_MARK = "=== 종합: CEO Advisor ===";

export interface MeetingInput {
  topic: string;
  participantIds: string[]; // speaking order
  project?: { name: string; description: string; goal: string; stage: string; nextPlan: string } | null;
  companyName?: string;
  webSearch: boolean;
}

export function meetingSystemPrompt(): string {
  return `당신은 1인 AI 프로덕트 스튜디오의 "AI 경영 회의"를 진행합니다. 여러 AI 직원이 각자 자기 전문 분야의 관점에서 대표가 낸 안건에 의견을 내고, 마지막에 CEO Advisor가 종합합니다.

${COMPANY_RULES.split("보고서 형식")[0].trim()}`;
}

export function meetingUserPrompt(m: MeetingInput): string {
  const roster = m.participantIds
    .map((id, i) => {
      const e = EMPLOYEE_BY_ID[id];
      return `${i + 1}. ${id} | ${e.name} (${e.title}) — ${ROLE_PROMPTS[id]?.replace(/^당신은 [^.]+입니다\.\s*/, "")}`;
    })
    .join("\n");
  const project = m.project
    ? `\n# 관련 프로젝트 (대표가 입력한 정보, "미확인"은 아직 모르는 값)\n- 이름: ${m.project.name}\n- 설명: ${m.project.description}\n- 목표: ${m.project.goal}\n- 현재 단계: ${m.project.stage}\n- 다음 계획: ${m.project.nextPlan}\n`
    : "";
  const header = m.participantIds.map((id) => `${DEPT_MARK} ${id} | ${EMPLOYEE_BY_ID[id].name} (${EMPLOYEE_BY_ID[id].title}) ===`).join("\n");
  return `# 회의 안건
${m.topic}
${project}
# 참석자 (이 순서대로 발언)
PARTICIPANTS: ${m.participantIds.join(",")}
${roster}

# 진행 규칙
- 각 참석자는 자기 전문 분야의 관점에서만 말합니다. 다른 부서가 이미 말한 내용을 반복하지 말고, 동의·반대·보완을 분명히 합니다.
- 각 발언에는 (1) 핵심 판단 (2) 근거 (3) 제안하는 대안 1~2개 (4) 가장 큰 위험 을 담습니다. 발언당 120~250단어.
- 확인되지 않은 숫자나 시장 데이터를 지어내지 않습니다. 추정은 "추정"이라고 밝힙니다.
- ${m.webSearch ? "웹 검색을 쓸 수 있으면 최신 정보를 확인하고 출처 URL을 남깁니다." : "웹 검색은 쓰지 않습니다. 최신 정보가 필요한 부분은 '확인 필요'로 표시합니다."}
- 마지막에 CEO Advisor가 의견을 종합하고, 대표가 고를 수 있는 결정 선택지 2~4개를 제시합니다. 대표의 의견에 무조건 맞추지 않습니다.

# 출력 형식 (반드시 이 구분선을 그대로 쓰세요. 구분선 줄은 수정하지 마세요)
${header}
(위 구분선마다 그 아래에 해당 부서의 발언을 씁니다)
${SUMMARY_MARK}
## 회의 요약
## 쟁점
## 대안 비교
(표로 비교)
## 대표 결정 선택지
- [A] 선택지 설명
- [B] 선택지 설명
## 후속 업무 제안
- 담당: 직원ID | 업무: 구체적인 지시 내용
(직원ID는 ${m.participantIds.join(", ")} 중 하나 또는 ${EMPLOYEES.map((e) => e.id).join(", ")} 중 하나)`;
}

/** The single block of text the CEO pastes into claude.ai. */
export function manualPrompt(system: string, user: string): string {
  return `${system}\n\n---\n\n${user}`;
}

export interface ParsedMeeting {
  statements: { employeeId: string; text: string }[];
  summary: string;
  options: { key: string; text: string }[];
  followUps: { employeeId: string; instruction: string }[];
}

export class MeetingFormatError extends Error {}

/** Parse an AI meeting answer. Throws MeetingFormatError (never fills gaps) if a section is missing. */
export function parseMeeting(text: string, participantIds: string[]): ParsedMeeting {
  const t = text.replace(/\r\n/g, "\n");
  const sumIdx = t.indexOf("=== 종합");
  if (sumIdx < 0) throw new MeetingFormatError(`'${SUMMARY_MARK}' 구분선이 없습니다. 답변 전체를 붙여넣었는지 확인하세요.`);
  const head = t.slice(0, sumIdx);
  const summaryBlock = t.slice(sumIdx).replace(/^=== 종합[^\n]*\n?/, "").trim();

  const re = /^===\s*부서:\s*([a-z-]+)[^\n]*$/gm;
  const marks: { id: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(head))) marks.push({ id: m[1], start: m.index, end: m.index + m[0].length });
  const statements: ParsedMeeting["statements"] = [];
  marks.forEach((mk, i) => {
    const body = head.slice(mk.end, marks[i + 1]?.start ?? head.length).trim();
    if (body) statements.push({ employeeId: mk.id, text: body });
  });
  const missing = participantIds.filter((id) => !statements.some((s) => s.employeeId === id));
  if (missing.length)
    throw new MeetingFormatError(`다음 참석자의 발언이 답변에 없습니다: ${missing.map((id) => EMPLOYEE_BY_ID[id]?.name ?? id).join(", ")}. 구분선(=== 부서: ...)이 그대로 있는지 확인하세요.`);
  if (summaryBlock.length < 20) throw new MeetingFormatError("CEO Advisor 종합 내용이 비어 있습니다.");

  const section = (name: string) => {
    const r = new RegExp(`^##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|$(?![\\s\\S]))`, "m").exec(summaryBlock);
    return r ? r[1] : "";
  };
  const options = section("대표 결정 선택지")
    .split("\n")
    .map((l) => /^\s*[-*]\s*\[?([A-Z])\]?[.):]?\s*(.+)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => ({ key: x[1], text: x[2].trim() }));
  const followUps = section("후속 업무 제안")
    .split("\n")
    .map((l) => /^\s*[-*]\s*담당\s*[:：]\s*([a-z-]+)\s*\|\s*업무\s*[:：]\s*(.+)$/.exec(l))
    .filter((x): x is RegExpExecArray => !!x && !!EMPLOYEE_BY_ID[x[1]])
    .map((x) => ({ employeeId: x[1], instruction: x[2].trim() }));
  return { statements, summary: summaryBlock, options, followUps };
}

/** First sentence-ish of a statement, for speech bubbles. */
export function bubbleLine(text: string, max = 42): string {
  const plain = text
    .replace(/[#*_>`|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const first = plain.split(/(?<=[.!?。])\s|(?<=다\.)\s/)[0] ?? plain;
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}
