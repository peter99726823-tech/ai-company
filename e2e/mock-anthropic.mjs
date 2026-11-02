// TEST ONLY. A stand-in for the Anthropic Messages API streaming endpoint, used to exercise the
// worker → DB → SSE → UI pipeline when no real API key is available. It is never used by the app;
// tests point ANTHROPIC_BASE_URL at it explicitly. Responses are clearly marked as mock output.
//
//   node e2e/mock-anthropic.mjs [port]
// Behaviour by keyword in the user prompt:
//   MOCK_500   → HTTP 500 every time (retry → FAILED)
//   MOCK_SLOW  → streams slowly (~20 s) so cancellation can be tested
//   MOCK_REFUSE→ stop_reason "refusal"
import http from "node:http";

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 4010);
let calls = 0;
let last = null;

const REPORT = `## 요약
[테스트용 가짜 응답] 이 보고서는 E2E 테스트용 모의 서버가 만든 것으로, 실제 Claude 분석이 아닙니다.

## 수행한 작업
- 지시 내용과 프로젝트 정보를 읽었습니다.

## 분석 결과
| 항목 | 내용 |
|---|---|
| 형식 | 표 렌더링 확인용 |

## 확인된 사실
- 대표가 입력한 프로젝트 정보만 사용했습니다.

## 가정과 불확실성
- 모든 내용은 테스트용입니다.

## 참고한 자료
- 웹 검색 미사용

## 결과물
<script>alert("xss")</script>
**굵은 글씨**와 목록이 표시되는지 확인합니다.

## 다음 추천 업무
- 실제 API 키로 같은 업무를 다시 실행하기
`;

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") return res.end("ok");
  if (req.method === "GET" && req.url === "/last") return res.end(JSON.stringify(last));
  if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  for await (const c of req) body += c;
  const j = JSON.parse(body);
  calls++;
  last = { url: req.url, beta: req.headers["anthropic-beta"] ?? null, body: { ...j, system: "(omitted)", messages: "(omitted)" } };
  const prompt = JSON.stringify(j.messages);
  if (req.headers["x-api-key"] !== "test-key-not-real") {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
  }
  if (prompt.includes("MOCK_500")) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock internal error" } }));
  }
  res.writeHead(200, { "content-type": "text/event-stream", "request-id": `req_mock_${calls}` });
  const model = j.model;
  sse(res, "message_start", {
    type: "message_start",
    message: { id: `msg_mock_${calls}`, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
  });
  if (prompt.includes("MOCK_REFUSE")) {
    sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null, stop_details: { type: "refusal", category: "cyber", explanation: "mock" } }, usage: { output_tokens: 0 } });
    sse(res, "message_stop", { type: "message_stop" });
    return res.end();
  }
  // thinking block (empty text, as with display "omitted")
  sse(res, "content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
  await sleep(prompt.includes("MOCK_SLOW") ? 2000 : 600);
  sse(res, "content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "mocksig" } });
  sse(res, "content_block_stop", { type: "content_block_stop", index: 0 });
  sse(res, "content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  const chunks = REPORT.match(/[\s\S]{1,40}/g);
  const delay = prompt.includes("MOCK_SLOW") ? 1000 : Number(process.env.MOCK_CHUNK_MS ?? 120);
  for (const t of chunks) {
    if (res.destroyed) return;
    sse(res, "content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: t } });
    await sleep(delay);
  }
  sse(res, "content_block_stop", { type: "content_block_stop", index: 1 });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 900 } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
});

server.listen(port, () => console.log(`[mock-anthropic] TEST ONLY on :${port}`));
