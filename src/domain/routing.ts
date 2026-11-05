/**
 * Pick who should do a task from the CEO's own words — with plain keyword rules, so routing
 * costs no AI call. The CEO always sees the choice and the reason, and can change it.
 */
import { EMPLOYEE_BY_ID } from "./employees";
import { DEFAULT_TYPE_FOR } from "./taskTypes";

const RULES: { id: string; words: string[] }[] = [
  { id: "planner", words: ["기획서", "사업계획", "공모전", "지원사업", "발표", "ppt", "목차", "제안서 양식", "kpi", "마일스톤", "로드맵"] },
  { id: "ai-engineer", words: ["에이전트", "llm", "프롬프트", "rag", "모델", "백테스트", "데이터 수집", "크롤링", "api 연동", "머신러닝", "ml", "평가 지표", "codex"] },
  { id: "frontend", words: ["화면", "ui", "ux", "디자인", "반응형", "qa", "버그", "테스트 시나리오", "점검표", "접근성", "레이아웃"] },
  { id: "cto", words: ["개발", "코드", "prd", "mvp", "기능", "아키텍처", "기술 스택", "앱", "게임 만들", "구현", "배포 계획", "데이터베이스"] },
  { id: "validator", words: ["검증", "시장", "경쟁", "수요", "타깃", "아이디어", "사업성", "고객 문제", "시장조사", "조사"] },
  { id: "pricing", words: ["가격", "요금", "수익 모델", "수익모델", "매출 예측", "손익분기", "구독", "광고 수익", "단가"] },
  { id: "sales", words: ["영업", "dm", "콜드", "고객 발굴", "제안서", "세일즈", "리드", "후속 연락"] },
  { id: "marketing", words: ["마케팅", "홍보", "콘텐츠", "sns", "인스타", "블로그", "랜딩", "카피", "광고 문구", "브랜딩", "숏폼"] },
  { id: "bookkeeper", words: ["재무", "회계", "손익", "현금흐름", "거래내역", "지출", "세금", "정산", "원가"] },
  { id: "contract", words: ["계약", "약관", "저작권", "라이선스", "개인정보", "법률", "위약금", "nda"] },
  { id: "ops", words: ["일정", "계획표", "업무 분해", "자동화", "체크리스트", "운영", "프로세스", "반복 업무", "시간표"] },
  { id: "ceo-advisor", words: ["우선순위", "전략", "방향", "결정", "중단", "집중", "목표"] },
];

export interface Routing {
  employeeId: string;
  type: string;
  reason: string;
}

export function routeTask(text: string): Routing {
  const t = text.toLowerCase();
  let best: { id: string; hits: string[] } = { id: "ceo-advisor", hits: [] };
  for (const r of RULES) {
    const hits = r.words.filter((w) => t.includes(w));
    // more matched words wins; on a tie the earlier (more specific) rule wins
    if (hits.length > best.hits.length) best = { id: r.id, hits };
  }
  // A name in the instruction ("은채에게", "준서가") beats keywords.
  for (const e of Object.values(EMPLOYEE_BY_ID)) {
    if (t.includes(e.name)) {
      return { employeeId: e.id, type: e.id === "ceo-advisor" || e.id === "contract" ? "GENERAL" : (DEFAULT_TYPE_FOR[e.id] ?? "GENERAL"), reason: `지시에 "${e.name}" 이름이 있음` };
    }
  }
  const e = EMPLOYEE_BY_ID[best.id];
  return {
    employeeId: best.id,
    type: best.id === "ceo-advisor" || best.id === "contract" ? "GENERAL" : (DEFAULT_TYPE_FOR[best.id] ?? "GENERAL"),
    reason: best.hits.length ? `키워드 ${best.hits.slice(0, 3).map((h) => `"${h}"`).join(", ")} → ${e.name}(${e.titleKo})` : "맞는 키워드가 없어 전략 고문 한결에게 배정",
  };
}
