"use client";

import dynamic from "next/dynamic";
import { TopBar } from "@/components/TopBar";
import { CameraControls, CameraHint } from "@/components/CameraControls";
import { EmployeePanel } from "@/components/EmployeePanel";
import { BottomDock } from "@/components/BottomDock";
import { useOfficeData } from "@/hooks/useOfficeData";
import { useOffice } from "@/store/officeStore";
import { useTaskDriver } from "@/hooks/useTaskDriver";
import { ReportModal } from "@/components/ReportModal";
import { Toasts } from "@/components/Toasts";
import { MeetingDialog } from "@/components/MeetingDialog";
import { MeetingModal } from "@/components/MeetingModal";
import { ManualTaskModal } from "@/components/ManualTaskModal";
import { ChatModal } from "@/components/ChatModal";
import { ProjectsModal } from "@/components/ProjectsModal";
import { FinanceModal } from "@/components/FinanceModal";
import { SettingsModal } from "@/components/SettingsModal";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), { ssr: false });

export default function Home() {
  const { data, health, error, live, reload } = useOfficeData();
  const ready = useOffice((s) => s.ready);
  useTaskDriver(data, ready);

  return (
    <main className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
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
      <ProjectsModal data={data} reload={reload} />
      <FinanceModal data={data} health={health} reload={reload} />
      <SettingsModal data={data} health={health} reload={reload} />
    </main>
  );
}
