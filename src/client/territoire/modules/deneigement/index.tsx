"use client";
/**
 * Environnement Déneigement (spec 5.4) : les trois zones de stationnement de nuit (réelles), les
 * feux d'interdiction (Simulation, inspirés du système de la Ville de Québec), la décision de
 * l'interdiction en deux gestes, les ressources par zone et l'avancement. Le chargement attend les
 * données (`/api/territoire/deneigement`) ; le montage pose les couches et les abonnements, le
 * démontage les retire tous (couches, sources, minuteries, sélection, pilotage).
 *
 * Pilotage (vérifications de bout en bout) : `window.__territoire.snow = { plans() }`.
 */
import type { Map as MlMap, MapMouseEvent } from "maplibre-gl";
import { SNOW_SIM_CREDIT, ZONES_ATTRIBUTION } from "@/lib/territoire/about";
import { DEPOTS } from "@/lib/territoire/fleet";
import type { DeneigementData, ZonePlan } from "@/lib/territoire/neige";
import { setFocus, territoireStore, type Focus } from "../../store";
import type { EnvModule, SceneCtx } from "../types";
import { applySnowLayers, blink, BLINK_HALF_MS, removeSnowLayers, setLightStates, setSelectedZone, setZoneStates } from "./layers";
import { SnowInspector } from "./Inspector";
import { SnowPanel } from "./Panel";
import { SnowScene, zoneInfos, type ZoneInfo } from "./Scene";
import { currentSnow, isZoneId, selectSnow, SNOW_CAMERA, snowStore, type SnowSelection } from "./state";

/** Zoom minimal quand la caméra est amenée sur une zone ou une ressource (alerte, recherche). */
const FOCUS_ZOOM = 12.4;

/** Largeurs réservées sur grand écran : panneau à gauche, fiche à droite, frise en bas (px). */
const FREE = { left: 330, right: 350, top: 40, bottom: 170 };

/** Déplace la carte (sans zoom) si le point tombe sous le panneau, la fiche ou la frise. */
function keepVisible(map: MlMap, lngLat: [number, number]) {
  const c = map.getContainer();
  if (c.clientWidth <= 720) return;
  const p = map.project(lngLat);
  const x = Math.min(c.clientWidth - FREE.right, Math.max(FREE.left, p.x));
  const y = Math.min(c.clientHeight - FREE.bottom, Math.max(FREE.top, p.y));
  if (x !== p.x || y !== p.y) map.panBy([p.x - x, p.y - y], { duration: 600 });
}

const zoneOfResource = (plans: readonly ZonePlan[], id: string) => plans.find((p) => p.resources.includes(id))?.zone ?? null;

/** Monte le déneigement sur la carte ; renvoie le démontage complet. */
function mountSnow(map: MlMap, data: DeneigementData, zones: readonly ZoneInfo[]): () => void {
  applySnowLayers(map, data);

  // --- plan → carte : zones et feux, seulement quand un état change (heure, décisions, météo)
  let sig = "";
  let lit = false;
  let phase = true;
  const sync = () => {
    const { plans } = currentSnow();
    const next = plans.map((p) => `${p.zone}:${p.ban}:${p.lights}`).join(",");
    if (next === sig) return;
    sig = next;
    setZoneStates(map, plans);
    setLightStates(map, plans);
    lit = plans.some((p) => p.lights === "allume");
    if (!lit && !phase) blink(map, (phase = true));
  };
  const tick = setInterval(sync, 1000);
  const offStore = territoireStore.subscribe((s, prev) => {
    if (s.actions !== prev.actions || s.clock !== prev.clock || s.forecast !== prev.forecast) sync();
    // une ressource sélectionnée peut changer de zone
    if (s.actions !== prev.actions || s.clock !== prev.clock) applySelection(snowStore.getState().selection);
  });
  // --- clignotement des feux allumés : période de 1 s
  // (mouvement réduit demandé : feux allumés fixes)
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const blinker = setInterval(() => {
    if (lit && !still) blink(map, (phase = !phase));
  }, BLINK_HALF_MS);

  // --- sélection → carte (zone choisie, ou zone de la ressource choisie)
  const at = new Map(zones.map((z) => [z.id, z.at]));
  function applySelection(sel: SnowSelection) {
    const zone = sel?.kind === "zone" ? sel.id : sel?.kind === "resource" ? zoneOfResource(currentSnow().plans, sel.id) : null;
    setSelectedZone(map, zone);
    return zone;
  }
  const offSel = snowStore.subscribe((s, prev) => {
    if (s.selection === prev.selection) return;
    const zone = applySelection(s.selection);
    // zone choisie sur la carte : son marquage reste visible entre le panneau et la fiche
    if (zone && s.selection?.kind === "zone") keepVisible(map, at.get(zone)!);
  });
  sync();
  applySelection(snowStore.getState().selection);

  // --- clic sur la carte : la zone sous le pointeur, sinon rien (les marquages ont leur propre clic)
  const onClick = (e: MapMouseEvent) => {
    const f = map.queryRenderedFeatures(e.point, { layers: ["dn-zone-fill"] })[0];
    const id = f ? String(f.properties.id) : "";
    selectSnow(isZoneId(id) ? { kind: "zone", id } : null);
  };
  map.on("click", onClick);

  // --- élément mis en avant (alerte, recherche) : consommé à l'arrivée ou dès qu'il change,
  // sélectionné, caméra amenée dessus ; un focus inconnu est effacé sans effet
  const applyFocus = (f: Focus) => {
    if (!f || f.env !== "deneigement") return;
    setFocus(null);
    let target: [number, number] | undefined;
    if (f.kind === "zone" && isZoneId(f.id)) {
      selectSnow({ kind: "zone", id: f.id });
      target = at.get(f.id);
    } else if (f.kind === "resource") {
      const r = data.fleet.find((x) => x.id === f.id);
      if (!r) return;
      selectSnow({ kind: "resource", id: r.id });
      const zone = zoneOfResource(currentSnow().plans, r.id);
      target = (zone && at.get(zone)) || DEPOTS[r.depot].at;
    }
    if (target) map.easeTo({ center: target, zoom: Math.max(map.getZoom(), FOCUS_ZOOM), duration: 1200 });
  };
  applyFocus(territoireStore.getState().focus);
  const offFocus = territoireStore.subscribe((s, prev) => s.focus !== prev.focus && applyFocus(s.focus));

  // --- pilotage
  const w = window as unknown as { __territoire?: Record<string, unknown> };
  const snow = { plans: () => currentSnow().plans };
  if (w.__territoire) w.__territoire.snow = snow;

  return () => {
    offFocus();
    offSel();
    offStore();
    clearInterval(tick);
    clearInterval(blinker);
    map.off("click", onClick);
    removeSnowLayers(map);
    selectSnow(null);
    if (w.__territoire?.snow === snow) delete w.__territoire.snow;
  };
}

/** Charge les zones, les feux et les ressources, puis rend le module (un par page, voir `loadModule`). */
export async function loadDeneigement(): Promise<EnvModule> {
  const r = await fetch("/api/territoire/deneigement");
  if (!r.ok) throw new Error(`Les zones de stationnement de nuit n'ont pas pu être chargées (HTTP ${r.status}).`);
  const data = (await r.json()) as DeneigementData;
  const zones = zoneInfos(data);

  function Scene({ ctx }: { ctx: SceneCtx }) {
    return <SnowScene ctx={ctx} zones={zones} />;
  }
  function Panel() {
    return <SnowPanel data={data} />;
  }
  function Inspector() {
    return <SnowInspector data={data} zones={zones} />;
  }

  return {
    id: "deneigement",
    camera: SNOW_CAMERA,
    attribution: [ZONES_ATTRIBUTION, SNOW_SIM_CREDIT],
    mount: ({ map }) => mountSnow(map, data, zones),
    Scene,
    Panel,
    Inspector,
  };
}
