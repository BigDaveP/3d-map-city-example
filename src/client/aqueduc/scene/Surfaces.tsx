"use client";
/**
 * Mode HTML-in-Canvas de la démo réseau d'eau : l'information est inscrite dans la scène 3D en HTML
 * réel, monté dans le canvas de MapLibre par `HicHost` :
 *  - `sector:<id>` : nom du secteur et un seul chiffre, peints au sol (secteurs à l'écran) ;
 *  - `incident:<tronçon>` : « BRIS PROBABLE », la conduite et une valeur clé, au sol le long de la rue ;
 *  - `sensor:<id>` : une valeur par capteur pertinent (`useTaggedSensors`, 8 au plus), face caméra ;
 *  - `cut:<tronçon>` : pendant l'étape d'isolation du scénario, coupe verticale sous la rue, de vanne
 *    à vanne (elle remplace alors le marquage de l'incident, dont elle porte l'information).
 * Les bâtiments les masquent (profondeur partagée) et bloquent les clics là où ils les cachent.
 */
import { useMemo } from "react";
import type { Map as MlMap } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import { metersPerPixel, placeGround, placePanel, placeVertical, verticalFlip, type PanelPlacement } from "../../carte/hic/geometry";
import { TRANSITION_MS } from "../../carte/hic/panelLayer";
import { HicHost, type HicHostProps, type SurfaceSpec } from "../../hic3d/HicHost";
import type { Metrics } from "../../metrics";
import { lineCenter, segment, type NetIndex } from "../net";
import { aqueducStore } from "../store";
import { useAq } from "../useAq";
import { cutLayout, cutView } from "./cut";
import { CutSection } from "./CutSection";
import { IncidentMark } from "./IncidentMark";
import { parseKey, rectQuad, SURFACE_SIZE, surfaceKey, type Quad } from "./marks";
import { SectorMark, useVisibleSectors } from "./SectorMark";
import { SensorTag, useTaggedSensors, type TagCover } from "./SensorTag";

type ML = typeof import("maplibre-gl");

/** Cap vers lequel pointe le haut des noms de secteurs : celui de la vue d'ouverture (lus de face). */
export const SECTOR_HEADING = -25;
/** Taille d'un px CSS des surfaces, en px écran au centre de la vue. */
const SCALE = { sector: 1, incident: 1, sensor: 1 } as const;
/**
 * Compensation de la distance (rapport distance à la caméra / distance du centre de la vue), bornée :
 * les étiquettes gardent à peu près leur taille à l'écran (lisibles au loin, discrètes au premier
 * plan) ; les marquages au sol grandissent un peu au loin, sans perdre la perspective.
 */
const DISTANCE = { sector: [0.85, 1.6], incident: [0.85, 1.6], sensor: [0.6, 2.4] } as const;
/** Opacité des parties de marquage au sol cachées par un bâtiment. */
const GROUND_GHOST = 0.45;
/** Hauteur de l'étiquette au-dessus du capteur (px CSS de l'étiquette). */
const SENSOR_LIFT_PX = 14;
/**
 * Écart côté caméra entre l'ancre et le bord du marquage (px CSS) : l'incident à côté de la conduite
 * plutôt que dessus, le secteur sous la station de qualité posée sur son centre (son étiquette
 * cacherait le chiffre).
 */
const GAP_PX = { sector: 12, incident: 24 } as const;
/**
 * Le centre du secteur Centre-ville est à une centaine de mètres de la conduite du scénario : pendant
 * un incident, le marquage du secteur touché s'écarte du bris, et celui de l'incident part de la
 * conduite dans la direction opposée au secteur (px CSS des marquages).
 */
const SECTOR_AWAY_PX = 170;
const INCIDENT_SLIDE_PX = 190;

/** px écran par mètre à un point, mesurés dans la direction de la droite de l'écran (sans raccourci). */
function pxPerMeter(map: MlMap, at: [number, number], bearing: number): number {
  const b = (bearing * Math.PI) / 180;
  const d = 10;
  const p0 = map.project(at);
  const p1 = map.project([at[0] + (Math.cos(b) * d) / (111_320 * Math.cos((at[1] * Math.PI) / 180)), at[1] - (Math.sin(b) * d) / 110_540]);
  return Math.hypot(p1.x - p0.x, p1.y - p0.y) / d;
}

interface Anchor {
  lngLat: [number, number];
  x: number;
  y: number;
  z: number;
  unit: number;
  /** cap du haut du texte (marquage de l'incident : perpendiculaire à la rue) */
  heading: number;
  /** secteur de la conduite (marquage de l'incident) */
  sector?: string;
}

/** Placement de chaque surface à chaque image, d'après la caméra courante. */
function layerOptions(ml: ML, map: MlMap, net: NetIndex): HicHostProps["layerOptions"] {
  const anchors = new Map<string, Anchor | null>();
  const cut = cutLayout(net);
  const cutEnds = cut && ([cut.from, cut.to].map((p) => ml.MercatorCoordinate.fromLngLat(p)) as [InstanceType<ML["MercatorCoordinate"]>, InstanceType<ML["MercatorCoordinate"]>]);
  // sens de lecture de la coupe : hystérésis (pas de scintillement quand la caméra regarde dans son axe)
  let cutFlipped: boolean | undefined;
  const at = (lngLat: [number, number], heading = 0): Anchor => {
    const m = ml.MercatorCoordinate.fromLngLat(lngLat, 0);
    return { lngLat, x: m.x, y: m.y, z: m.z, unit: m.meterInMercatorCoordinateUnits(), heading };
  };
  const anchor = (key: string): Anchor | null => {
    if (anchors.has(key)) return anchors.get(key)!;
    const k = parseKey(key);
    let a: Anchor | null = null;
    if (k?.kind === "sector") {
      const s = net.sectorById.get(k.id);
      if (s) a = at(s.at, SECTOR_HEADING);
    } else if (k?.kind === "sensor") {
      const s = net.sensorById.get(k.id);
      if (s) a = at(s.at);
    } else if (k?.kind === "incident") {
      const i = net.segById.get(k.id);
      if (i !== undefined) {
        const f = segment(net, i);
        const c = f.geometry.coordinates;
        const p0 = ml.MercatorCoordinate.fromLngLat(c[0] as [number, number]);
        const p1 = ml.MercatorCoordinate.fromLngLat(c[c.length - 1] as [number, number]);
        // le texte court le long de la rue : sa « droite » suit le segment, son haut lui est perpendiculaire
        const along = (Math.atan2(p1.x - p0.x, -(p1.y - p0.y)) * 180) / Math.PI;
        a = { ...at(lineCenter(f), along - 90), sector: f.properties.s };
      }
    }
    anchors.set(key, a);
    return a;
  };
  return {
    place: (key, { bearing, pitch, zoom }): PanelPlacement | null => {
      const k = parseKey(key);
      if (k?.kind === "cut") {
        if (!cutEnds) return null;
        const from: [number, number] = [cutEnds[0].x, cutEnds[0].y];
        const to: [number, number] = [cutEnds[1].x, cutEnds[1].y];
        const f = verticalFlip(from, to, bearing, cutFlipped);
        if (f !== cutFlipped) {
          cutFlipped = f;
          // le contenu suit (vannes et profil en miroir) ; hors de la boucle de rendu de la couche
          if (cutView.getState().reversed !== f) queueMicrotask(() => cutView.setState({ reversed: f }));
        }
        const { w, h } = SURFACE_SIZE.cut;
        // bord haut au niveau de la chaussée : la coupe descend sous la rue
        return placeVertical(from, to, 0, h, cutEnds[0].meterInMercatorCoordinateUnits(), bearing, w, f);
      }
      const a = anchor(key);
      if (!k || !a) return null;
      const { w, h } = SURFACE_SIZE[k.kind];
      const [lo, hi] = DISTANCE[k.kind];
      const c = map.getCenter();
      const ratio = Math.min(hi, Math.max(lo, pxPerMeter(map, [c.lng, c.lat], bearing) / pxPerMeter(map, a.lngLat, bearing) || 1));
      const mPerPx = SCALE[k.kind] * ratio * metersPerPixel(a.lngLat[1], zoom);
      if (k.kind === "sensor") return placePanel(a, w, h, a.unit, mPerPx, SENSOR_LIFT_PX * mPerPx, "billboard", bearing, pitch, 0);
      let center: { x: number; y: number; z: number } = a;
      const inc = k.kind === "sector" && aqueducStore.getState().incident ? anchor(surfaceKey("incident", CITY.breakSegment)) : null;
      if (inc && inc.sector === k.id) {
        const dx = a.x - inc.x;
        const dy = a.y - inc.y;
        const n = Math.hypot(dx, dy) || 1;
        const g = SECTOR_AWAY_PX * mPerPx * a.unit;
        center = { x: a.x + (g * dx) / n, y: a.y + (g * dy) / n, z: a.z };
      }
      const p = placeGround(center, w, h, a.unit, mPerPx, a.heading, bearing);
      const g = h / 2 + GAP_PX[k.kind];
      let slide = 0;
      const sec = k.kind === "incident" && a.sector ? anchor(surfaceKey("sector", a.sector)) : null;
      if (sec) slide = (sec.x - a.x) * p.r[0] + (sec.y - a.y) * p.r[1] > 0 ? -INCIDENT_SLIDE_PX : INCIDENT_SLIDE_PX;
      p.o = [p.o[0] + g * p.d[0] + slide * p.r[0], p.o[1] + g * p.d[1] + slide * p.r[1], p.o[2]];
      return p;
    },
    effects: () => ({ fog: true, shadow: false, transition: "dissolve", transitionMs: TRANSITION_MS }),
    // marquages au sol : ils transparaissent sous les bâtiments, translucides (opacité 0,78), comme
    // les conduites et le fond de carte ; les étiquettes de capteurs restent masquées
    ghost: (key) => (parseKey(key)?.kind === "sensor" ? 0 : GROUND_GHOST),
  };
}

const onFallback = (reason: string) => aqueducStore.setState({ mode: "classic", fallback: `Mode classique activé automatiquement : ${reason}` });
const onActive = () => {
  if (aqueducStore.getState().api !== "active") aqueducStore.setState({ api: "active" });
};

export function SceneSurfaces({ ml, map, metrics, net }: { ml: ML; map: MlMap; metrics: Metrics; net: NetIndex }) {
  const sectors = useVisibleSectors(map, net);
  const cut = useMemo(() => cutLayout(net), [net]);
  // la coupe, à l'isolation, porte l'information de l'incident : son marquage au sol s'efface
  const showCut = useAq((s) => s.scenario.active && s.scenario.step === "isolation") && cut !== null;
  const incident = useAq((s) => s.incident !== null) && !showCut;
  // lu une fois par la couche : constant pour un réseau donné
  const options = useMemo(() => layerOptions(ml, map, net), [ml, map, net]);
  const cover = useMemo<TagCover>(() => {
    // zone d'écran d'une bande [v0, v1] (fraction de la hauteur) d'un marquage au sol
    const band = (key: string, v0: number, v1: number): Quad | null => {
      const k = parseKey(key);
      const p = k && options.place!(key, { bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom() });
      if (!k || !p) return null;
      const { w, h } = SURFACE_SIZE[k.kind];
      return [[0, v0 * h], [w, v0 * h], [w, v1 * h], [0, v1 * h]].map(([u, v]) => {
        const c = new ml.MercatorCoordinate(p.o[0] + u * p.r[0] + v * p.d[0], p.o[1] + u * p.r[1] + v * p.d[1], 0).toLngLat();
        const s = map.project(c);
        return [s.x, s.y] as [number, number];
      });
    };
    // zone d'écran approchée de la coupe : son bord haut (au sol), prolongé vers le bas dans les
    // proportions de la surface (vue presque de face à l'isolation)
    const cutQuad = (): Quad | null => {
      if (!cut) return null;
      const [a, b] = [map.project(cut.from), map.project(cut.to)];
      const down = Math.max(60, (Math.hypot(b.x - a.x, b.y - a.y) * SURFACE_SIZE.cut.h) / SURFACE_SIZE.cut.w);
      return [[a.x, a.y - 30], [b.x, b.y - 30], [b.x, b.y + down], [a.x, a.y + down]];
    };
    return {
      // étiquette de 120 × 26 px à 14 px au-dessus du capteur (taille écran ≈ taille CSS, voir DISTANCE)
      tag: (p) => rectQuad(p.x - 62, p.y - 46, p.x + 62, p.y - 10),
      figures: () =>
        [
          ...sectors.map((s) => band(surfaceKey("sector", s.id), 0.5, 1)),
          incident ? band(surfaceKey("incident", CITY.breakSegment), 0, 1) : null,
          showCut ? cutQuad() : null,
        ].filter((q): q is Quad => !!q),
    };
  }, [ml, map, options, sectors, incident, showCut, cut]);
  const tagged = useTaggedSensors(map, net, cover);
  const surfaces = useMemo<SurfaceSpec[]>(
    () => [
      ...sectors.map((s) => ({
        key: surfaceKey("sector", s.id),
        ...SURFACE_SIZE.sector,
        version: 0,
        focusable: true,
        mipmap: true,
        render: () => <SectorMark net={net} sector={s} drawable />,
      })),
      ...(incident
        ? [
            {
              key: surfaceKey("incident", CITY.breakSegment),
              ...SURFACE_SIZE.incident,
              version: 0,
              focusable: true,
              mipmap: true,
              render: () => <IncidentMark net={net} id={CITY.breakSegment} drawable />,
            },
          ]
        : []),
      ...tagged.map((s) => ({
        key: surfaceKey("sensor", s.id),
        ...SURFACE_SIZE.sensor,
        version: 0,
        focusable: true,
        render: () => <SensorTag sensor={s} drawable />,
      })),
      ...(showCut && cut
        ? [
            {
              key: surfaceKey("cut", CITY.breakSegment),
              ...SURFACE_SIZE.cut,
              version: 0,
              focusable: true,
              render: () => <CutSection net={net} cut={cut} drawable />,
            },
          ]
        : []),
    ],
    [sectors, incident, tagged, net, showCut, cut],
  );
  return <HicHost ml={ml} map={map} metrics={metrics} surfaces={surfaces} layerOptions={options} onFallback={onFallback} onActive={onActive} />;
}
