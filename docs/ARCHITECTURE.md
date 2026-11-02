# 아키텍처

## 핵심 원칙

1. **화면은 서버 상태를 그릴 뿐이다.** 업무 상태는 DB의 `tasks.status`가 유일한 기준입니다. 캐릭터 애니메이션이 끝났다고 업무가 끝나지 않습니다.
2. **게임 렌더링과 AI 실행을 분리한다.** Phaser는 그림, 이동, 애니메이션만 맡습니다. AI 호출은 서버의 워커 프로세스만 합니다. 브라우저는 Claude API를 직접 부르지 않습니다.
3. **실패는 실패로 보인다.** API 키가 없거나 호출이 실패하면 `FAILED`와 실제 오류 메시지를 표시합니다. 가짜 결과를 만들지 않습니다.
4. **게임 속도는 연출 속도다.** 0.5x~4x는 이동, 대기 연출, 애니메이션에만 적용됩니다. 서버 작업 시간은 바뀌지 않습니다.

## 전체 구조

```
┌──────────────── 브라우저 ────────────────┐        ┌──────────── 서버 (로컬 Node) ─────────────┐
│ React UI (Next.js)                       │  HTTP  │ Next.js Route Handlers                    │
│  TopBar · EmployeePanel · BottomDock     │◀──────▶│  /api/office   스냅샷                     │
│        │ zustand store                   │  SSE   │  /api/health   연결 상태                  │
│        ▼                                 │◀───────│  /api/events   이벤트 스트림 (SSE)        │
│ bridge (typed bus)                       │        │  /api/tasks    업무 생성·취소·재시도      │
│        ▼                                 │        │            │                              │
│ Phaser OfficeScene                       │        │            ▼                              │
│  맵 · A* 이동 · 애니메이션 · 카메라        │        │  SQLite (WAL)  ◀──────▶  Worker 프로세스  │
└──────────────────────────────────────────┘        │                          Task Orchestrator│
                                                    │                          AI Agent Engine ──┼──▶ Claude API
                                                    └───────────────────────────────────────────┘
```

- **웹 서버와 워커는 별도 프로세스**이고 SQLite 파일(WAL 모드)로만 소통합니다. 웹 페이지를 닫아도 워커가 살아 있으면 업무는 계속됩니다. 워커가 꺼지면 업무가 멈추고, 화면 상단에 "실행기 꺼짐"이 표시됩니다 (PHASE 2).
- **이벤트 흐름:** 워커가 상태를 바꿀 때마다 `task_events`에 한 줄을 남깁니다. `/api/events`(SSE)는 이 테이블을 `id` 순서로 읽어 보냅니다. 연결이 끊기면 브라우저는 `/api/office` 스냅샷을 다시 받고, `Last-Event-ID` 이후부터 이어 받습니다.
- **중복 실행 방지:** 워커는 `UPDATE tasks SET lease_owner=?, lease_until=? WHERE id=? AND status='QUEUED' AND (lease_until IS NULL OR lease_until < now)`로 업무를 선점한 뒤에만 실행합니다. 새로고침이나 다중 탭은 업무를 다시 만들지 않습니다.

## 모듈

| 모듈 | 위치 | 역할 | 상태 |
|---|---|---|---|
| Office Game Engine | `src/game/` | 맵, A* 경로, 충돌, 픽셀 캐릭터, 카메라 | PHASE 1 ✅ |
| Employee Manager | `src/domain/employees.ts`, `src/server/ai/prompts.ts` | 직원 9명 프로필, 외형, 책상, 버전별 시스템 프롬프트 | ✅ |
| Project Manager | `projects` 테이블, `/api/office` | 프로젝트 정보 | 조회만 ✅, 편집은 2 |
| Event Logger | `src/server/tasks/service.ts` (`transition`) | 상태 변경과 이벤트를 한 트랜잭션으로 기록 | ✅ |
| AI Agent Engine | `src/server/ai/engine.ts` | Claude 스트리밍 호출, 진행 신호, 오류 분류 | ✅ |
| Task Orchestrator | `src/server/tasks/runner.ts`, `worker/index.ts` | 선점, 실행, 재시도, 취소, 실행기 중단 처리 | ✅ |
| Report Manager | `reports` 테이블, `/api/reports/[id]`, `ReportModal` | 보고서 저장·구조화·열람 | ✅ |
| Cost Tracker | `src/server/ai/pricing.ts`, `api_usage` | 실제 토큰 사용량 × 가격표 = 추정 비용, 일일 한도 | ✅ |
| Approval Manager | `approvals` 테이블 | 승인, 수정 요청, 후속 업무 | PHASE 3 |
| Meeting | `meetings`, `meeting_participants` | 순차 발언, 호출 수·비용 상한 | PHASE 3 |
| Scheduler | `worker/` | 반복 업무, 자동 모드 한도 | PHASE 4 |

## 디렉터리

```
ai-company/
├─ docs/                   이 문서와 설정 안내
├─ drizzle/                SQL 마이그레이션 (자동 적용)
├─ data/                   SQLite 파일 (git 제외)
├─ e2e/phase1.mjs          브라우저 E2E 검사
├─ public/fonts/           Galmuri 픽셀 폰트 (OFL)
├─ tests/                  단위 테스트 (맵, 경로)
└─ src/
   ├─ app/                 Next.js 페이지와 API
   │  ├─ page.tsx          메인 화면
   │  └─ api/{health,office}/route.ts
   ├─ components/          TopBar, EmployeePanel, BottomDock, CameraControls
   ├─ domain/              타입, 업무 상태·이벤트 목록, 직원·프로젝트 정의 (서버·클라이언트 공용)
   ├─ game/                Phaser 계층 (서버 코드를 import하지 않음)
   │  ├─ map/              officeMap.ts (타일 그리드), pathfinding.ts (A*)
   │  ├─ sprites/          characterArt.ts (캐릭터 32프레임), officeArt.ts (바닥·벽·가구)
   │  ├─ entities/         EmployeeActor.ts (이동·애니메이션·이름표·말풍선)
   │  ├─ scenes/           OfficeScene.ts (장면, 카메라, 입력, 대기 행동)
   │  ├─ bridge.ts         React ↔ Phaser 메시지
   │  └─ PhaserGame.tsx    마운트
   ├─ hooks/useOfficeData.ts
   ├─ store/officeStore.ts (zustand)
   ├─ server/              서버 전용 ("server-only")
   │  ├─ db/               schema.ts, client.ts, seed-data.ts
   │  └─ services/office.ts
   └─ proxy.ts             APP_PASSWORD 설정 시 Basic 인증
```

## 캐릭터 상태와 서버 상태의 연결

| 서버 이벤트 | 캐릭터 동작 | 말풍선 |
|---|---|---|
| TASK_ASSIGNED | 현재 위치 → 자기 책상 | "업무 확인 중..." |
| TASK_STARTED (PLANNING) | thinking | "계획 세우는 중..." |
| TASK_PROGRESS (RUNNING) | working, 모니터 점등 | 서버가 보낸 단계 메시지 |
| TASK_TOOL_STARTED (web_search) | working | "자료 검색 중..." |
| TASK_APPROVAL_REQUESTED | 대표실 → waiting | "대표 승인 대기" |
| TASK_COMPLETED | 대표실 → reporting → 책상 | "업무 완료!" |
| TASK_FAILED | error | 실제 오류 요약 |
| MEETING_STARTED / ENDED | 회의실 좌석 → meeting / 복귀 | 실제 발언 요약 |

진행률(`progress`)은 서버가 아는 단계(계획, 호출 시작, 스트리밍 수신량, 저장)로만 올립니다. 시간 경과로 채우지 않습니다.

구현: `src/hooks/useTaskDriver.ts`가 DB 스냅샷의 업무 상태에서 "원하는 캐릭터 상태"를 계산해 게임에 명령합니다. 이벤트를 하나씩 재생하는 방식이 아니라 저장된 상태에서 계산하므로, 새로고침이나 재연결 후에도 캐릭터가 올바른 위치로 돌아옵니다. 업무가 있는 직원은 1.8배 빠르게 걷습니다.

## 데이터베이스

`src/server/db/schema.ts`에 16개 테이블이 있습니다: `company`, `settings`, `employees`, `employee_prompts`, `projects`, `tasks`, `task_executions`, `task_events`, `conversations`, `messages`, `meetings`, `meeting_participants`, `reports`, `approvals`, `financial_transactions`, `api_usage`.

- 금액은 정수(마이크로 달러, 원)로 저장해 소수 오차를 피합니다.
- `api_usage.cost_is_estimate`와 `price_table_version`으로 비용이 실제 청구액인지, 가격표로 계산한 추정치인지 구분합니다.
- `financial_transactions.is_simulation`으로 실제 거래와 시뮬레이션을 구분합니다.
- 서버가 처음 DB를 열 때 마이그레이션을 자동 적용하고, 비어 있으면 회사·직원 9명·프로젝트 5개를 넣습니다.
