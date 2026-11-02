"use client";

import { useEffect, useRef, useState } from "react";
import { fromGame, toGame } from "./bridge";
import { useOffice } from "@/store/officeStore";
import { EMPLOYEE_BY_ID } from "@/domain/employees";

/**
 * Mounts the Phaser game. Phaser is imported only in the browser (it touches `window`).
 * Wires bridge events into the zustand store.
 */
export default function PhaserGame() {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let cancelled = false;
    const s = useOffice.getState();
    const offs = [
      fromGame.on("ready", () => {
        s.setReady();
        toGame.emit("speed", useOffice.getState().speed);
      }),
      fromGame.on("selected", (id) => useOffice.getState().setSelected(id)),
      fromGame.on("following", (id) => useOffice.getState().setFollowing(id)),
      fromGame.on("actor", (a) => useOffice.getState().upsertActor(a)),
      fromGame.on("movement", (m) => useOffice.getState().pushMovement({ id: m.id, text: `${EMPLOYEE_BY_ID[m.id]?.name ?? m.id} · ${m.text}` })),
    ];

    (async () => {
      try {
        // The background and labels are drawn with the pixel font, so wait for it first.
        await Promise.race([document.fonts.load('12px "Galmuri11"'), new Promise((r) => setTimeout(r, 3000))]);
        const Phaser = (await import("phaser")).default;
        const { OfficeScene } = await import("./scenes/OfficeScene");
        if (cancelled || !host.current) return;
        game = new Phaser.Game({
          type: Phaser.AUTO,
          parent: host.current,
          backgroundColor: "#0b0d15",
          pixelArt: true,
          antialias: false,
          scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
          scene: [OfficeScene],
          banner: false,
          input: { mouse: { preventDefaultWheel: true } },
        });
      } catch (e) {
        setFailed((e as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      offs.forEach((o) => o());
      game?.destroy(true);
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="absolute inset-0" data-testid="office-canvas" />
      {failed && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-bad">
          사무실 화면을 불러오지 못했습니다: {failed}
        </div>
      )}
    </div>
  );
}
