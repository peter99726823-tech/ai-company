"use client";

import { useEffect, useMemo, useState } from "react";
import { useOffice } from "@/store/officeStore";
import { toGame, type Destination } from "@/game/bridge";
import { EMPLOYEE_BY_ID } from "@/domain/employees";
import { ACTIVITIES, ACTIVITY_LABEL, TASK_STATUS_LABEL, type Activity, type TaskStatus } from "@/domain/types";
import { portraitDataUrl } from "@/game/sprites/characterArt";
import type { OfficeSnapshot } from "@/server/services/office";
import type { Health } from "@/hooks/useOfficeData";

const PREVIEW_DEST: Record<Activity, Destination> = {
  idle: "desk",
  walk: "stay",
  working: "desk",
  thinking: "desk",
  meeting: "meeting",
  reporting: "report",
  resting: "lounge",
  error: "stay",
  waiting: "report",
};

export function EmployeePanel({ data, health }: { data: OfficeSnapshot | null; health: Health | null }) {
  const id = useOffice((s) => s.selectedId);
  const actor = useOffice((s) => (id ? s.actors[id] : undefined));
  const [tab, setTab] = useState<"info" | "order">("info");
  const [instruction, setInstruction] = useState("");
  const [projectId, setProjectId] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const profile = id ? EMPLOYEE_BY_ID[id] : null;
  const portrait = useMemo(() => (profile ? portraitDataUrl(profile.look, 4) : ""), [profile]);
  useEffect(() => {
    setTab("info");
    setInstruction("");
  }, [id]);

  if (!profile || !id) return null;
  const mine = data?.byEmployee?.[id];
  const engineReady = !!health?.ai.engineConnected;

  return (
    <aside
      className="px-frame scroll-thin absolute inset-x-2 bottom-2 z-10 max-h-[70%] overflow-y-auto rounded-md bg-panel/95 backdrop-blur md:inset-x-auto md:bottom-auto md:right-2 md:top-2 md:max-h-[calc(100%-16px)] md:w-[340px]"
      aria-label={`${profile.name} 상세`}
    >
      <div className="flex items-start gap-3 border-b-2 border-line p-3" style={{ boxShadow: `inset 0 3px 0 ${profile.look.accent}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={portrait} alt="" width={64} height={96} className="pixelated shrink-0 rounded-sm bg-panel-2" />
        <div className="min-w-0 flex-1">
          <div className="pixel text-[17px] font-bold">{profile.name}</div>
          <div className="pixel text-[12px]" style={{ color: profile.look.accent }}>
            {profile.title}
          </div>
          <div className="text-[12px] text-muted">{profile.titleKo}</div>
          <div className="pixel mt-1 text-[11px] text-muted">
            {actor?.roomName ?? ""} · 명령어 <span className="text-ink">{profile.command}</span>
          </div>
        </div>
        <button type="button" onClick={() => toGame.emit("select", null)} className="pixel rounded-sm px-2 text-muted hover:text-ink" aria-label="닫기">
          ✕
        </button>
      </div>

      <div className="flex gap-1 border-b-2 border-line px-3 pt-2">
        {(["info", "order"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`pixel -mb-[2px] rounded-t-sm border-2 border-b-0 px-3 py-1 text-[12px] ${tab === t ? "border-line bg-panel-2 text-ink" : "border-transparent text-muted"}`}
          >
            {t === "info" ? "정보" : "업무 지시"}
          </button>
        ))}
      </div>

      {tab === "info" ? (
        <div className="space-y-3 p-3 text-[13px]">
          <Section title="현재 상태">
            <div className="flex flex-wrap items-center gap-2">
              <span className="pixel rounded-sm bg-panel-2 px-2 py-0.5 text-[12px]">캐릭터: {actor ? ACTIVITY_LABEL[actor.activity] : "–"}</span>
              {actor?.mode === "preview" && <span className="pixel rounded-sm bg-warn/20 px-2 py-0.5 text-[11px] text-warn">애니메이션 미리보기 중</span>}
            </div>
            <p className="mt-1 text-[12px] text-muted">
              캐릭터 동작은 화면 연출입니다. 실제 업무 상태는 아래 &lsquo;진행 중인 업무&rsquo;가 기준입니다.
            </p>
          </Section>

          <Section title="진행 중인 업무">
            {mine?.activeTask ? (
              <div className="rounded-sm bg-panel-2 p-2">
                <div className="font-medium">{mine.activeTask.title}</div>
                <div className="pixel text-[11px] text-muted">{TASK_STATUS_LABEL[mine.activeTask.status as TaskStatus]}</div>
              </div>
            ) : (
              <p className="text-muted">없음</p>
            )}
          </Section>

          <Section title="최근 완료한 업무">
            {mine?.recentCompleted.length ? (
              <ul className="space-y-1">
                {mine.recentCompleted.map((t) => (
                  <li key={t.id} className="truncate">
                    {t.title}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">아직 없습니다.</p>
            )}
          </Section>

          <Section title="전문 분야">
            <div className="flex flex-wrap gap-1">
              {profile.expertise.map((x) => (
                <span key={x} className="rounded-sm border border-line px-1.5 py-0.5 text-[12px] text-muted">
                  {x}
                </span>
              ))}
            </div>
          </Section>

          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => setTab("order")}>업무 지시</ActionButton>
            <ActionButton disabled title="PHASE 2에서 연결됩니다">
              대화하기
            </ActionButton>
            <ActionButton disabled title="PHASE 2에서 연결됩니다">
              보고서 {mine?.reportCount ?? 0}건
            </ActionButton>
            <ActionButton onClick={() => toGame.emit("follow", id)}>카메라 따라가기</ActionButton>
          </div>

          <details open={previewOpen} onToggle={(e) => setPreviewOpen((e.target as HTMLDetailsElement).open)} className="rounded-sm border border-dashed border-line p-2">
            <summary className="pixel cursor-pointer text-[12px] text-muted">개발자 도구 · 애니메이션 미리보기</summary>
            <p className="mt-2 text-[12px] text-warn">미리보기는 캐릭터 동작 확인용이며 실제 업무가 아닙니다.</p>
            <div className="mt-2 grid grid-cols-3 gap-1">
              {ACTIVITIES.filter((a) => a !== "walk").map((a) => (
                <button
                  key={a}
                  type="button"
                  className="pixel rounded-sm bg-panel-2 px-1 py-1 text-[11px] hover:text-hi"
                  onClick={() => toGame.emit("command", { id, go: PREVIEW_DEST[a], activity: a, bubble: `미리보기 · ${ACTIVITY_LABEL[a]}`, source: "preview" })}
                >
                  {ACTIVITY_LABEL[a]}
                </button>
              ))}
            </div>
            <button type="button" className="pixel mt-2 w-full rounded-sm border border-line py-1 text-[11px] text-muted hover:text-ink" onClick={() => toGame.emit("release", id)}>
              미리보기 끝내기
            </button>
          </details>
        </div>
      ) : (
        <form className="space-y-2 p-3 text-[13px]" onSubmit={(e) => e.preventDefault()}>
          <label className="block">
            <span className="pixel text-[12px] text-muted">관련 프로젝트</span>
            <select
              id="order-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="mt-1 w-full rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
            >
              <option value="">선택 안 함</option>
              {data?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="pixel text-[12px] text-muted">{profile.name}에게 지시할 업무</span>
            <textarea
              id="order-text"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={5}
              placeholder="예: Number Maze라는 퍼즐 게임의 수익화 전략을 분석하고 장단점을 보고서로 작성해줘."
              className="mt-1 w-full resize-y rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5"
            />
          </label>
          <button
            type="submit"
            disabled={!engineReady || !instruction.trim()}
            className="pixel w-full rounded-sm bg-hi py-2 text-[13px] font-bold text-void disabled:cursor-not-allowed disabled:opacity-40"
          >
            업무 지시하기
          </button>
          {!engineReady && (
            <p className="rounded-sm bg-warn/10 p-2 text-[12px] text-warn">
              실제 AI 업무 실행 엔진은 PHASE 2에서 연결됩니다. 지금은 업무를 저장하거나 실행하지 않으며, 가짜 결과도 만들지 않습니다.
            </p>
          )}
        </form>
      )}
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="pixel mb-1 text-[11px] uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

function ActionButton({ children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...p}
      className="pixel rounded-sm border-2 border-line bg-panel-2 px-2 py-1.5 text-[12px] hover:border-hi disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line"
    >
      {children}
    </button>
  );
}
