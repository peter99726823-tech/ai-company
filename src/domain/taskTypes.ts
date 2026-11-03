/** Task types the founder can assign. Shared by the UI (form) and the server (prompt guide). */

export interface TaskTypeDef {
  id: string;
  label: string;
  guide: string;
  supported: boolean;
  /** Why it cannot run yet and what would be needed. */
  needs?: string;
  /** Benefits from fresh web data. Runs without it, but the report must say so. */
  wantsWeb?: boolean;
  /** The form offers a text-file upload whose contents are added to the instruction. */
  upload?: boolean;
  /** Not a single-employee task: the form sends the CEO to the meeting dialog instead. */
  meeting?: boolean;
}

export const TASK_TYPES: TaskTypeDef[] = [
  { id: "GENERAL", label: "일반 업무", guide: "지시 내용에 맞게 보고서를 작성합니다.", supported: true },
  { id: "BUSINESS_IDEA", label: "사업 아이디어 분석", guide: "고객 문제, 타깃, 수익 모델, 실행 난이도, 위험, 100점 평가와 GO/PIVOT/HOLD/STOP 권고를 포함합니다.", supported: true },
  { id: "PRODUCT_PLAN", label: "제품·게임 기획", guide: "핵심 재미 또는 가치, 타깃 사용자, MVP 기능 범위(포함/제외), 화면 흐름, 단계별 개발 계획, 검증 방법을 포함합니다.", supported: true },
  { id: "MARKET_REPORT", label: "시장 검증 보고서", guide: "시장 규모 근거, 경쟁 서비스 비교표, 가격과 후기 경향, 차별성, 초기 고객 확보 경로를 포함합니다.", supported: true, wantsWeb: true },
  { id: "PRICING", label: "가격 전략 제안", guide: "원가 가정표, 경쟁 가격, 3단계 가격안, 판매량별 매출·이익 표, 손익분기점을 포함합니다.", supported: true, wantsWeb: true },
  { id: "MARKETING_CONTENT", label: "마케팅 콘텐츠 작성", guide: "채널별 실제 사용 가능한 콘텐츠 초안과 목표 지표를 포함합니다. 결과물 섹션에 복사해 쓸 수 있는 본문을 넣습니다.", supported: true },
  { id: "SALES_MESSAGE", label: "영업 메시지 작성", guide: "고객 유형, 고객 문제에서 출발하는 DM·이메일 초안, 후속 메시지, 예상 거절 사유와 대응을 포함합니다.", supported: true },
  { id: "TRANSACTIONS", label: "거래내역 분석", guide: "대표가 지시문에 붙여넣은 거래내역만 사용합니다. 분류표, 고정비·변동비, 손익, 이상 지출을 포함합니다. 내역이 없으면 필요한 형식을 안내합니다.", supported: true },
  { id: "CONTRACT", label: "계약서 분석 (본문 붙여넣기)", guide: "대표가 지시문에 붙여넣은 계약서 본문만 검토합니다. 조항 인용, 위험도, 수정 문구, 변호사 확인 항목을 포함합니다.", supported: true },
  { id: "CONTRACT_FILE", label: "계약서 파일 분석 (.txt .md)", guide: "대표가 올린 계약서 파일 내용(지시문에 포함)만 검토합니다. 조항 인용, 위험도, 수정 문구, 변호사 확인 항목을 포함합니다.", supported: true, upload: true },
  { id: "WORK_PLAN", label: "프로젝트 업무 계획", guide: "목표, 작업 분해, 순서, 예상 시간, 담당(AI/대표), 완료 기준, 위험을 표로 포함합니다.", supported: true },
  { id: "MULTI_DEPT", label: "여러 부서 종합 보고서 → 회의로 진행", guide: "", supported: false, needs: "여러 부서 종합 보고서는 상단의 '회의 소집'으로 진행합니다.", meeting: true },
];

export const TASK_TYPE_BY_ID = Object.fromEntries(TASK_TYPES.map((t) => [t.id, t])) as Record<string, TaskTypeDef>;

export const DEFAULT_TYPE_FOR: Record<string, string> = {
  "ceo-advisor": "GENERAL",
  validator: "BUSINESS_IDEA",
  cto: "PRODUCT_PLAN",
  pricing: "PRICING",
  sales: "SALES_MESSAGE",
  marketing: "MARKETING_CONTENT",
  bookkeeper: "TRANSACTIONS",
  contract: "CONTRACT",
  ops: "WORK_PLAN",
  planner: "GENERAL",
  "ai-engineer": "PRODUCT_PLAN",
  frontend: "PRODUCT_PLAN",
};
