"use client";
/**
 * Marquage d'un secteur : son nom et un seul chiffre (adresses desservies ; pendant un incident,
 * adresses en basse pression puis sans eau, calculées depuis le flux). Au sol dans la scène
 * (`drawable`), étiquette plate en mode classique.
 */
import { useEffect, useMemo, useState } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { THRESHOLDS } from "@/lib/aqueduc/sim";
import { useThrottled } from "../../hic3d/useThrottled";
import { num } from "../format";
import type { NetIndex } from "../net";
import type { NetworkData, SegmentProps } from "../pipes";
import { select, type AqState } from "../store";
import { useAq } from "../useAq";
import { impactBySector, sectorFigure, SURFACE_SIZE, surfaceKey, type SectorImpact } from "./marks";

type SectorInfo = NetworkData["sectors"][number];

// impact par secteur, calculé une fois par message du flux (clé : le tableau de pressions reçu)
const impactCache = new WeakMap<Float32Array, Map<string, SectorImpact>>();
const propsCache = new WeakMap<NetIndex, SegmentProps[]>();
export function impactOf(net: NetIndex, s: AqState): Map<string, SectorImpact> | null {
  if (!s.incident) return null;
  let m = impactCache.get(s.live.pressure);
  if (!m) {
    let props = propsCache.get(net);
    if (!props) propsCache.set(net, (props = net.data.segments.features.map((f) => f.properties)));
    m = impactBySector(props, net.data.demoSegments, s.live.pressure, THRESHOLDS.pressureMin);
    impactCache.set(s.live.pressure, m);
  }
  return m;
}

/** Le chiffre du secteur, recapturé au plus toutes les 2 s. */
export function useSectorFigure(net: NetIndex, sector: SectorInfo) {
  const raw = useAq((s) => {
    const served = s.live.sectors.find((x) => x.id === sector.id)?.served ?? sector.addresses;
    const f = sectorFigure(served, impactOf(net, s)?.get(sector.id));
    return `${f.value}|${f.tone}|${f.label}`;
  });
  const [value, tone, label] = useThrottled(raw).split("|");
  return { value: Number(value), tone, label };
}

/**
 * Adresses touchées par l'incident, tous secteurs : en basse pression (vannes ouvertes) et sans
 * eau (tronçon isolé), avec le détail par secteur ; recalculées au plus toutes les 2 s.
 */
export function useImpactTotals(net: NetIndex): { low: number; dry: number; sectors: { id: string; low: number; dry: number }[] } {
  const raw = useAq((s) => {
    const m = impactOf(net, s);
    return m ? [...m].map(([id, v]) => `${id}:${v.low}:${v.dry}`).join(",") : "";
  });
  const shown = useThrottled(raw);
  return useMemo(() => {
    const sectors = shown ? shown.split(",").map((e) => e.split(":")).map(([id, low, dry]) => ({ id, low: Number(low), dry: Number(dry) })) : [];
    return { low: sectors.reduce((a, x) => a + x.low, 0), dry: sectors.reduce((a, x) => a + x.dry, 0), sectors };
  }, [shown]);
}

/** Taille du nom (px) pour tenir dans la largeur du marquage ; espacement léger : il se lit comme un mot. */
function nameStyle(name: string) {
  const spacing = 0.04;
  const size = Math.min(42, Math.floor((SURFACE_SIZE.sector.w - 16) / (name.length * (0.7 + spacing))));
  return { fontSize: size, letterSpacing: `${spacing}em` };
}

export function SectorMark({ net, sector, drawable }: { net: NetIndex; sector: SectorInfo; drawable?: boolean }) {
  const f = useSectorFigure(net, sector);
  const selected = useAq((s) => s.selection?.kind === "sector" && s.selection.id === sector.id);
  const name = sector.name.toUpperCase();
  const scene = drawable ? { "data-panel": surfaceKey("sector", sector.id), drawable: "", style: { width: SURFACE_SIZE.sector.w, height: SURFACE_SIZE.sector.h } } : {};
  return (
    <button
      type="button"
      className="aq-mark aq-mark-sector"
      data-tone={f.tone}
      aria-pressed={selected}
      aria-label={`Secteur ${sector.name} (simulé) : ${num(f.value)} ${f.label}`}
      onClick={() => select({ kind: "sector", id: sector.id })}
      {...scene}
    >
      <span className="aq-mark-name" style={drawable ? nameStyle(name) : undefined}>
        {name}
      </span>
      <span className="aq-mark-fig">
        <span className="aq-num">{num(f.value)}</span> {f.label}
      </span>
    </button>
  );
}

/**
 * Secteurs dont le centre est à l'écran (hors bande de l'horizon), recalculés à la fin de chaque
 * mouvement de caméra : seuls ceux-là portent un marquage.
 */
export function useVisibleSectors(map: MlMap, net: NetIndex): SectorInfo[] {
  const [ids, setIds] = useState("");
  useEffect(() => {
    const update = () => {
      const c = map.getCanvas();
      const w = c.clientWidth;
      const h = c.clientHeight;
      const next = net.data.sectors
        .filter((s) => {
          const p = map.project(s.at);
          return p.x >= -0.05 * w && p.x <= 1.05 * w && p.y >= 0.18 * h && p.y <= 1.02 * h;
        })
        .map((s) => s.id)
        .join(",");
      setIds(next);
    };
    update();
    map.on("moveend", update);
    map.on("resize", update);
    return () => {
      map.off("moveend", update);
      map.off("resize", update);
    };
  }, [map, net]);
  return useMemo(() => (ids ? ids.split(",").map((id) => net.sectorById.get(id)!) : []), [ids, net]);
}

