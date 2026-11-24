"use client";
import { useEffect, useRef } from "react";
import { KINDS } from "@/lib/sim/types";
import type { WorldLayout } from "@/lib/world";
import type { Camera } from "../camera";
import type { DataStore } from "../store";
import type { FrameLoop } from "./frame";

/** Libellés de régions en surimpression (DOM, espace écran) : identiques dans les deux modes. */
export function RegionLabels({ layout, camera, loop, ds }: { layout: WorldLayout; camera: Camera; loop: FrameLoop; ds: DataStore }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const counts = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    let lastCam = -1;
    let lastCount = 0;
    const branches = ds.store.getState().branches;
    return loop.add((now) => {
      if (camera.version !== lastCam) {
        lastCam = camera.version;
        const size = Math.max(13, Math.min(56, 90 * camera.zoom));
        layout.regions.forEach((r, i) => {
          const el = refs.current[i];
          if (!el) return;
          const [sx, sy] = camera.worldToScreen(r.x + 70, r.y + 40);
          el.style.transform = `translate(${sx}px, ${sy}px)`;
          el.style.fontSize = `${size}px`;
        });
      }
      if (now - lastCount > 500) {
        lastCount = now;
        const crit = new Array(layout.regions.length).fill(0);
        const st = ds.live.statuses;
        for (let c = 0; c < st.length; c++) if (st[c] === 2) crit[branches[Math.floor(c / KINDS.length)].regionIdx]++;
        crit.forEach((v, i) => {
          const el = counts.current[i];
          if (el) el.textContent = `${v} critiques`;
        });
      }
    });
  }, [layout, camera, loop, ds]);
  return (
    <div className="labels" aria-hidden>
      {layout.regions.map((r, i) => (
        <div key={r.id} className="rlabel" ref={(el) => void (refs.current[i] = el)}>
          {r.name}
          <small ref={(el) => void (counts.current[i] = el)} />
        </div>
      ))}
    </div>
  );
}
