"use client";
/**
 * Inscriptions du déneigement dans la scène : un marquage par zone (`ZoneMark`), posé au sol en
 * mode HTML-in-Canvas (surface `zone:<id>` de `HicHost`, placée par `placeGround` comme les
 * marquages de secteurs de l'aqueduc, masquée par les bâtiments) ; étiquette plate (marqueur DOM)
 * en mode classique. Même composant, même contenu.
 */
import { useMemo } from "react";
import type { Map as MlMap } from "maplibre-gl";
import type { ZoneId } from "@/lib/territoire/day";
import { labelPoint } from "@/lib/territoire/geo";
import type { DeneigementData, ZonePlan } from "@/lib/territoire/neige";
import { metersPerPixel, placeGround, pxPerMeter, type PanelPlacement } from "../../../hic3d/geometry";
import { HicHost, type HicHostProps, type SurfaceSpec } from "../../../hic3d/HicHost";
import { TRANSITION_MS } from "../../../hic3d/panelLayer";
import { Pin } from "../../scene/Pin";
import { hicActive, hicFallback } from "../../store";
import { useTerritoire } from "../../useTerritoire";
import type { SceneCtx } from "../types";
import { SNOW_CAMERA, useSnowPlans } from "./state";
import { MARK_SIZE, markKey, ZoneMark } from "./ZoneMark";

type ML = typeof import("maplibre-gl");

/** Le haut des noms pointe vers le cap de la vue d'ouverture : ils se lisent de face. */
const HEADING = SNOW_CAMERA.bearing;
/** Taille d'un px CSS du marquage, en px écran au centre de la vue : discret à l'échelle de la ville. */
const SCALE = 0.62;
/** Compensation de la distance, bornée (comme les marquages de secteurs). */
const DISTANCE: [number, number] = [0.85, 1.6];
/** Opacité des parties du marquage cachées par un bâtiment. */
const GROUND_GHOST = 0.45;

export interface ZoneInfo {
  id: ZoneId;
  name: string;
  /** point d'étiquette, à l'intérieur de la zone */
  at: [number, number];
  /** nombre de feux de la zone */
  lights: number;
}

/** Zones avec leur point d'étiquette et leur nombre de feux (une fois par jeu de données). */
export function zoneInfos(data: DeneigementData): ZoneInfo[] {
  return data.zones.map((z) => ({ id: z.id, name: z.name, at: labelPoint(z.polygon), lights: data.lights.filter((l) => l.zone === z.id).length }));
}

function layerOptions(ml: ML, map: MlMap, zones: readonly ZoneInfo[]): HicHostProps["layerOptions"] {
  const anchors = new Map(
    zones.map((z) => {
      const m = ml.MercatorCoordinate.fromLngLat(z.at, 0);
      return [markKey(z.id), { lngLat: z.at, x: m.x, y: m.y, z: m.z, unit: m.meterInMercatorCoordinateUnits() }] as const;
    }),
  );
  return {
    place: (key, { bearing, zoom }): PanelPlacement | null => {
      const a = anchors.get(key);
      if (!a) return null;
      const c = map.getCenter();
      const ratio = Math.min(DISTANCE[1], Math.max(DISTANCE[0], pxPerMeter(map, [c.lng, c.lat], bearing) / pxPerMeter(map, a.lngLat, bearing) || 1));
      return placeGround(a, MARK_SIZE.w, MARK_SIZE.h, a.unit, SCALE * ratio * metersPerPixel(a.lngLat[1], zoom), HEADING, bearing);
    },
    effects: () => ({ fog: true, shadow: false, transition: "dissolve", transitionMs: TRANSITION_MS }),
    ghost: () => GROUND_GHOST,
  };
}

function HicMarks({ ctx, zones, plans }: { ctx: SceneCtx; zones: readonly ZoneInfo[]; plans: readonly ZonePlan[] }) {
  const { ml, map, metrics } = ctx;
  // lu une fois par la couche : constant pour un jeu de zones
  const options = useMemo(() => layerOptions(ml, map, zones), [ml, map, zones]);
  const surfaces = useMemo<SurfaceSpec[]>(
    () =>
      zones.flatMap((z) => {
        const plan = plans.find((p) => p.zone === z.id);
        if (!plan) return [];
        return [{ key: markKey(z.id), ...MARK_SIZE, version: 0, focusable: true, mipmap: true, render: () => <ZoneMark plan={plan} name={z.name} lights={z.lights} drawable /> }];
      }),
    [zones, plans],
  );
  return <HicHost ml={ml} map={map} metrics={metrics} surfaces={surfaces} layerOptions={options} onFallback={hicFallback} onActive={hicActive} />;
}

export function SnowScene({ ctx, zones }: { ctx: SceneCtx; zones: readonly ZoneInfo[] }) {
  const mode = useTerritoire((s) => s.mode);
  const { plans } = useSnowPlans();
  if (mode === "hic") return <HicMarks ctx={ctx} zones={zones} plans={plans} />;
  return (
    <>
      {zones.map((z) => {
        const plan = plans.find((p) => p.zone === z.id);
        return plan ? (
          <Pin key={z.id} ml={ctx.ml} map={ctx.map} at={z.at} anchor="center" className="aq-flat dn-flat">
            <ZoneMark plan={plan} name={z.name} lights={z.lights} />
          </Pin>
        ) : null;
      })}
    </>
  );
}
