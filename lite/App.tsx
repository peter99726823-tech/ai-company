"use client";
import { useEffect, useState } from "react";
import PhaserGame from "@/game/PhaserGame";
import { TopBar } from "@/components/TopBar";
import { CameraControls, CameraHint } from "@/components/CameraControls";
import { EmployeePanel } from "@/components/EmployeePanel";
import { BottomDock } from "@/components/BottomDock";
import { ReportModal } from "@/components/ReportModal";
import { Toasts } from "@/components/Toasts";
import { MeetingDialog } from "@/components/MeetingDialog";
import { MeetingModal } from "@/components/MeetingModal";
import { ManualTaskModal } from "@/components/ManualTaskModal";
import { ChatModal } from "@/components/ChatModal";
import { useOfficeData } from "@/hooks/useOfficeData";
import { useTaskDriver } from "@/hooks/useTaskDriver";
import { useOffice } from "@/store/officeStore";
import { saveState, type SaveState } from "./save";

export function App({ storeKind }: { storeKind: "artifact" | "local" }) {
  const { data, health, error, live, reload } = useOfficeData();
  const ready = useOffice((s) => s.ready);
  useTaskDriver(data, ready);
  const [save, setSave] = useState<SaveState>(saveState.get());
  useEffect(() => saveState.subscribe(setSave), []);

  return (
    <main className="grid h-dvh grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
      <div className="pixel flex flex-wrap items-center justify-center gap-x-3 bg-panel-2 px-3 py-1 text-center text-[11px] text-muted">
        <span>링크 버전 · 업무와 회의는 claude.ai 붙여넣기 방식(무료)으로 처리합니다</span>
        <span className={save.status === "error" ? "text-bad" : save.status === "saving" ? "text-warn" : "text-ok"} data-testid="save-state">
          {save.status === "saving"
            ? "저장 중…"
            : save.status === "error"
              ? `저장 실패: ${save.error}`
              : save.at
                ? `${storeKind === "artifact" ? "링크 저장소" : "이 브라우저"}에 저장됨 ${new Date(save.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
                : storeKind === "artifact"
                  ? "기록은 링크 저장소에 자동 저장됩니다"
                  : "기록은 이 브라우저에 자동 저장됩니다"}
        </span>
      </div>
      <TopBar data={data} health={health} live={live} />
      <div className="relative min-h-[320px] overflow-hidden">
        <PhaserGame />
        {!ready && <div className="pixel absolute inset-0 grid place-items-center text-muted">사무실을 여는 중…</div>}
        <CameraControls />
        <CameraHint />
        <EmployeePanel data={data} health={health} reload={reload} />
        <Toasts />
      </div>
      <div className="h-[clamp(130px,22vh,210px)]">
        <BottomDock data={data} error={error} />
      </div>
      <ReportModal data={data} health={health} reload={reload} />
      <MeetingDialog data={data} health={health} reload={reload} />
      <MeetingModal health={health} reload={reload} />
      <ManualTaskModal reload={reload} />
      <ChatModal data={data} health={health} reload={reload} />
    </main>
  );
}
