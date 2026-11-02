# 설정: 환경 변수와 AI API 연결

## 환경 변수

`.env.example`을 `.env.local`로 복사해서 채웁니다. `.env.local`은 git에 올라가지 않습니다.

| 변수 | 필수 | 기본값 | 설명 |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | PHASE 2부터 | 없음 | Claude API 키. 서버와 워커에서만 읽습니다. 브라우저 응답에는 키가 있는지 여부만 나갑니다. |
| `AI_MODEL` | 아니요 | `claude-opus-5-5` | 직원들이 쓰는 모델 |
| `AI_DAILY_BUDGET_USD` | 아니요 | `5` | 하루 API 비용 한도. 넘으면 새 업무를 실행하지 않고 `FAILED`(예산 초과)로 표시합니다. |
| `AI_MAX_CALLS_PER_TASK` | 아니요 | `3` | 업무 1건당 최대 호출 수 (재시도 포함) |
| `DATABASE_PATH` | 아니요 | `./data/company.db` | SQLite 파일 위치 |
| `APP_PASSWORD` | 외부 공개 시 필수 | 없음 | 값이 있으면 모든 페이지와 API에 비밀번호(HTTP Basic, 사용자 이름은 아무거나)가 필요합니다. |

## Claude API 연결 방법

1. [Claude Console](https://platform.claude.com/)에서 API 키를 만듭니다.
2. 콘솔의 Billing에서 크레딧과 월 한도를 설정합니다. 앱의 `AI_DAILY_BUDGET_USD`는 보조 장치이고, 진짜 안전장치는 콘솔 한도입니다.
3. `.env.local`에 넣습니다.
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. 서버를 다시 시작합니다. 상단 바의 "AI" 표시가 "API 키 없음"에서 바뀌면 키가 읽힌 것입니다. 실제 호출 성공 여부는 PHASE 2에서 첫 업무를 실행할 때 확인되어 "연결됨"으로 바뀝니다.

### 사용 모델과 비용 (2026-10 기준 가격표)

| 모델 | 입력 $/100만 토큰 | 출력 $/100만 토큰 |
|---|---|---|
| `claude-opus-5-5` (기본) | 4.00 | 20.00 |
| `claude-sonnet-5-5` | 2.00 | 10.00 |
| `claude-haiku-5-5` | 0.10 | 0.50 |

보고서 1건(입력 약 3천, 출력 약 3천 토큰)은 Opus 5.5 기준 대략 0.07달러입니다. 모델의 생각(thinking) 토큰은 출력으로 청구되므로 실제로는 더 늘 수 있습니다. 이 숫자는 가격표로 계산한 추정치입니다. 앱도 같은 방식으로 계산하고 "(추정)"으로 표시합니다. 실제 청구액은 콘솔에서 확인하세요.

### PHASE 2 연동 방식 (예정)

- 공식 TypeScript SDK `@anthropic-ai/sdk`를 워커에서만 사용합니다.
- 보고서 생성은 스트리밍 + `finalMessage()`로 받아 긴 응답에서도 타임아웃이 나지 않게 합니다.
- 웹 검색은 Anthropic 서버 도구(`web_search`)를 쓰며, 설정에서 켠 경우에만 붙습니다. 끈 상태의 보고서에는 "웹 검색 미사용, 모델 학습 지식 기준"이라고 명시합니다.
- 파일 작업이나 코드 수정은 Claude Agent SDK 도입 여부를 PHASE 3 이후 따로 검토합니다. 쓰더라도 허용된 프로젝트 폴더 안으로 제한합니다.

## 보안 체크리스트

- [x] API 키는 서버 환경 변수로만 관리 (`/api/health`는 키 값을 반환하지 않음)
- [x] `APP_PASSWORD`로 외부 공개 시 인증
- [x] DB 파일, `.env*`는 git 제외
- [ ] 업무별 호출 횟수 제한, 일일 예산 차단 (PHASE 2)
- [ ] 이메일 발송, 결제, 배포, 외부 게시 등은 대표 승인 후에만 실행 (PHASE 3)
- [ ] 백업: `data/company.db`를 주기적으로 복사하세요. 앱 안의 백업 버튼은 PHASE 4에서 추가합니다.

> 로컬에서만 쓸 때는 `npm start`가 `localhost:3000`에 열립니다. 공유기 포트포워딩이나 터널로 외부에 열 때는 반드시 `APP_PASSWORD`를 먼저 설정하세요.
