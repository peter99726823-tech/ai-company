"use client";

import { toGame } from "@/game/bridge";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

export function CameraHint() {
  return (
    <span className="pixel pointer-events-none absolute bottom-2 left-2 hidden rounded-sm bg-panel/80 px-2 py-1 text-[11px] text-muted sm:inline">
      휠: 확대·축소 · 드래그: 이동 · 클릭: 직원 선택
    </span>
  );
}

export function CameraControls() {
  const selectedId = useOffice((s) => s.selectedId);
  const followingId = useOffice((s) => s.followingId);
  const btn = "pixel grid h-8 min-w-8 place-items-center rounded-sm border-2 border-line bg-panel/90 px-2 text-[12px] hover:border-hi";
  return (
    <div className="pointer-events-auto absolute left-2 top-2 flex flex-wrap gap-1" aria-label="카메라">
      <button type="button" className={btn} onClick={() => toGame.emit("fit", undefined)} title="사무실 전체 보기">
        전체 보기
      </button>
      <button type="button" className={btn} onClick={() => toGame.emit("zoomBy", 1.25)} aria-label="확대">
        +
      </button>
      <button type="button" className={btn} onClick={() => toGame.emit("zoomBy", 0.8)} aria-label="축소">
        −
      </button>
      {selectedId && (
        <button
          type="button"
          className={`${btn} ${followingId === selectedId ? "border-hi text-hi" : ""}`}
          onClick={() => toGame.emit("follow", followingId === selectedId ? null : selectedId)}
        >
          {followingId === selectedId ? "따라가기 해제" : `${EMPLOYEE_BY_ID[selectedId]?.name} 따라가기`}
        </button>
      )}
    </div>
  );
}
