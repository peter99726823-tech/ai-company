"use client";

import dynamic from "next/dynamic";
import { TopBar } from "@/components/TopBar";
import { CameraControls, CameraHint } from "@/components/CameraControls";
import { EmployeePanel } from "@/components/EmployeePanel";
import { BottomDock } from "@/components/BottomDock";
import { useOfficeData } from "@/hooks/useOfficeData";
import { useOffice } from "@/store/officeStore";

const PhaserGame = dynamic(() => import("@/game/PhaserGame"), { ssr: false });

export default function Home() {
  const { data, health, error } = useOfficeData();
  const ready = useOffice((s) => s.ready);

  return (
    <main className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
      <TopBar data={data} health={health} />
      <div className="relative min-h-[320px] overflow-hidden">
        <PhaserGame />
        {!ready && <div className="pixel absolute inset-0 grid place-items-center text-muted">사무실을 여는 중…</div>}
        <CameraControls />
        <CameraHint />
        <EmployeePanel data={data} health={health} />
      </div>
      <div className="h-[clamp(130px,22vh,210px)]">
        <BottomDock data={data} error={error} />
      </div>
    </main>
  );
}
