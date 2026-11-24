"use client";
/**
 * Mode classique : les informations inscrites dans la scène en mode HTML-in-Canvas (secteurs,
 * incident, capteurs) sont ici des étiquettes plates en DOM, des marqueurs MapLibre toujours au
 * premier plan : ni perspective, ni masquage par les bâtiments. Mêmes composants, même contenu.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Map as MlMap, PositionAnchor } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import { lineCenter, segment, type NetIndex } from "../net";
import { IncidentMark } from "../scene/IncidentMark";
import { inBox } from "../scene/marks";
import { SectorMark, useVisibleSectors } from "../scene/SectorMark";
import { SensorTag } from "../scene/SensorTag";
import { useAq } from "../useAq";

type ML = typeof import("maplibre-gl");

/** Pendant un incident, l'étiquette du secteur touché s'écarte du bris (m), comme dans la scène. */
const SECTOR_AWAY_M = 170;

/** Point à `m` mètres de `at`, dans la direction opposée à `from`. */
function awayFrom(at: [number, number], from: [number, number], m: number): [number, number] {
  const kx = 111_320 * Math.cos((at[1] * Math.PI) / 180);
  const ky = 110_540;
  const dx = (at[0] - from[0]) * kx;
  const dy = (at[1] - from[1]) * ky;
  const n = Math.hypot(dx, dy) || 1;
  return [at[0] + (m * dx) / n / kx, at[1] + (m * dy) / n / ky];
}

/** Marqueur MapLibre dont le contenu est rendu par React (portail). */
function Pin({ ml, map, at, anchor, className, children }: { ml: ML; map: MlMap; at: [number, number]; anchor: PositionAnchor; className: string; children: ReactNode }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    const div = document.createElement("div");
    div.className = className;
    // un clic sur l'étiquette ne doit pas atteindre la carte (qui désélectionnerait)
    div.addEventListener("click", (e) => e.stopPropagation());
    const marker = new ml.Marker({ element: div, anchor }).setLngLat(at).addTo(map);
    setEl(div);
    return () => void marker.remove();
  }, [ml, map, at, anchor, className]);
  return el ? createPortal(children, el) : null;
}

export function ClassicScene({ ml, map, net }: { ml: ML; map: MlMap; net: NetIndex }) {
  const sectors = useVisibleSectors(map, net);
  const incident = useAq((s) => s.incident !== null);
  const tagged = useMemo(() => net.data.sensors.filter((s) => inBox(s.at, CITY.demoBox)), [net]);
  const brk = useMemo(() => {
    const i = net.segById.get(CITY.breakSegment);
    return i === undefined ? null : { at: lineCenter(segment(net, i)), sector: segment(net, i).properties.s };
  }, [net]);
  const incidentAt = brk?.at ?? null;
  // position de l'étiquette de chaque secteur (stable tant que l'incident ne change pas : le marqueur n'est pas recréé)
  const labelAt = useMemo(() => {
    const m = new Map<string, [number, number]>();
    for (const s of net.data.sectors) m.set(s.id, incident && brk && brk.sector === s.id ? awayFrom(s.at, brk.at, SECTOR_AWAY_M) : s.at);
    return m;
  }, [net, incident, brk]);
  return (
    <>
      {sectors.map((s) => (
        <Pin key={s.id} ml={ml} map={map} at={labelAt.get(s.id)!} anchor="top" className="aq-flat aq-flat-sector">
          <SectorMark net={net} sector={s} />
        </Pin>
      ))}
      {incident && incidentAt && (
        <Pin ml={ml} map={map} at={incidentAt} anchor="top" className="aq-flat aq-flat-incident">
          <IncidentMark net={net} id={CITY.breakSegment} />
        </Pin>
      )}
      {tagged.map((s) => (
        <Pin key={s.id} ml={ml} map={map} at={s.at} anchor="bottom" className="aq-pin">
          <SensorTag sensor={s} />
          <span className="aq-stem" aria-hidden="true" />
        </Pin>
      ))}
    </>
  );
}
