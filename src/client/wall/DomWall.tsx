"use client";
/**
 * Mode DOM (référence) : cartes en <div> positionnées dans un monde transformé en CSS,
 * virtualisation (seules les cartes visibles + marge sont montées) et même zoom sémantique.
 */
import { memo, useEffect, useRef, useState } from "react";
import { KINDS } from "@/lib/sim/types";
import { CARD_H, CARD_W, MID_SCALE, type Level, type WorldLayout } from "@/lib/world";
import type { Camera } from "../camera";
import type { Metrics } from "../hic3d/metrics";
import { statusOf, useData, type DataStore } from "../store";
import { useStore } from "zustand";
import { cardLevel, togglePin, uiStore } from "../ui";
import { Card } from "./cards/Card";
import type { FrameLoop } from "./frame";
import { sameList, visibleCards } from "./visible";

interface Props {
  ds: DataStore;
  camera: Camera;
  loop: FrameLoop;
  metrics: Metrics;
  layout: WorldLayout;
  level: Level;
}

export function DomWall({ ds, camera, loop, metrics, layout, level }: Props) {
  const worldRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<number[]>([]);
  const pinned = useStore(uiStore, (s) => s.pinned);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    let current: number[] = [];
    const scratch: number[] = [];
    const visibleSince = new Float64Array(layout.cards.length / 4);
    const prevSince = new Map<number, number>();
    let lastCam = -1;
    return loop.add((now) => {
      const el = worldRef.current;
      if (!el) return;
      if (camera.version !== lastCam) {
        lastCam = camera.version;
        const z = camera.zoom;
        el.style.transform = `translate(${camera.vw / 2 - camera.x * z}px, ${camera.vh / 2 - camera.y * z}px) scale(${z})`;
        visibleCards(layout, camera.view(0.08), scratch);
        if (!sameList(scratch, current)) {
          for (const c of current) visibleSince[c] = 0;
          for (const c of scratch) visibleSince[c] = prevSince.get(c) ?? now;
          current = scratch.slice();
          prevSince.clear();
          for (const c of current) prevSince.set(c, visibleSince[c]);
          setVisible(current);
        }
      }
      // latence donnée -> pixel : en DOM, le commit React de cette frame affiche la donnée
      const live = ds.live;
      const textLevel = levelRef.current > 0;
      for (let c = 0; c < live.dirtySince.length; c++) {
        const d = live.dirtySince[c];
        if (!d) continue;
        // même définition qu'en canvas : donnée reçue alors que la carte était déjà affichée
        if (textLevel && visibleSince[c] && visibleSince[c] <= d) metrics.latency(now - d);
        live.dirtySince[c] = 0;
      }
      metrics.mounted = current.length;
    });
  }, [ds, camera, loop, metrics, layout]);

  return (
    <div className="dom-world" ref={worldRef}>
      {layout.regions.map((r) => (
        <div key={r.id} className="region-bg" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
      ))}
      {visible.map((c) => (
        <Slot key={c} ds={ds} card={c} level={cardLevel(level, pinned, c)} pinnedFromMid={level === 1 && pinned.includes(c)} layout={layout} />
      ))}
    </div>
  );
}

const Slot = memo(function Slot({ ds, card, level, layout, pinnedFromMid }: { ds: DataStore; card: number; level: Level; layout: WorldLayout; pinnedFromMid: boolean }) {
  const x = layout.cards[card * 4];
  const y = layout.cards[card * 4 + 1];
  if (level === 0) return <Tile ds={ds} card={card} x={x} y={y} />;
  return (
    <div className="slot" style={{ left: x, top: y, width: CARD_W, height: CARD_H }}>
      {level === 1 ? (
        <Card ds={ds} card={card} level={1} style={{ transform: `scale(${1 / MID_SCALE})`, transformOrigin: "0 0" }} />
      ) : (
        <Card ds={ds} card={card} level={2} onClose={pinnedFromMid ? () => togglePin(card) : undefined} />
      )}
    </div>
  );
});

function Tile({ ds, card, x, y }: { ds: DataStore; card: number; x: number; y: number }) {
  const b = Math.floor(card / KINDS.length);
  const status = useData(ds, (s) => statusOf(s, b, KINDS[card % KINDS.length]));
  return <div className={`tile st${status}`} data-card={card} style={{ left: x, top: y, width: CARD_W, height: CARD_H }} />;
}
