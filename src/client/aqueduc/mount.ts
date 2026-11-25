/**
 * Branchement de l'aqueduc sur la scène commune (sans React) : couches des conduites et des
 * capteurs, clic, store → carte, vue souterraine, scénario de bris (caméra et incident qui suit
 * l'horloge commune), flux des capteurs, élément mis en avant (`focus`) et API de pilotage
 * `window.__aqueduc`. `mountAqueduc` rend un démontage complet : la carte reste, l'aqueduc s'en va.
 */
import type { CameraOptions, Map as MlMap, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import { CITY } from "@/lib/aqueduc/city";
import type { Metrics } from "../hic3d/metrics";
import { setFocus, territoireStore, type Focus } from "../territoire/store";
import { lineCenter, segment, selectionCenter, type NetIndex } from "./net";
import { applyPipeLayers, markSegment, PICK_LAYERS, removePipeLayers, setPipeLayer, setPipeValues, setSensorStatus } from "./pipes";
import { closeValves, exploreFreely, faceBearing, goToStep, startScenario, STEP_VIEW, type StepId } from "./scenarioController";
import { attachScenario, stepSelection, syncIncident, type CameraTarget } from "./scenarioSync";
import { cutLayout } from "./scene/cut";
import { attachUnderground, type TubeLayer } from "./scene/tubes";
import { aqueducStore, select, type AqState, type Selection } from "./store";
import { attachStream } from "./stream";
import { setTagWorkSink } from "./tagWork";

/** Cadrage de l'environnement : centre-ville, incliné, cap vers le nord-ouest. */
export const START_VIEW = { center: CITY.center, zoom: 15.4, pitch: 58, bearing: -25 };

/** Marges de la caméra pendant le scénario : récit à gauche, frise en bas, fiche à droite si ouverte. */
const GAP = 14;
const STORY_W = 300;
const TIMELINE_H = 118;
const INSPECTOR_W = 320;

/**
 * Caméra du scénario (easeTo) : vue de l'étape, centrée sur le bris ou sur la coupe, dans la partie
 * de la carte que le récit et la fiche laissent libre. « start » retient la vue du visiteur, « exit »
 * la lui rend sans marges.
 */
function scenarioCamera(map: MlMap, net: NetIndex) {
  const cut = cutLayout(net);
  const i = net.segById.get(CITY.breakSegment);
  const brk = i === undefined ? CITY.center : lineCenter(segment(net, i));
  let saved: CameraOptions | null = null;
  return (target: CameraTarget, duration: number) => {
    if (target === "start") {
      saved = { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
      return;
    }
    const wide = map.getContainer().clientWidth > 720;
    if (target === "exit") {
      map.easeTo({ ...(saved ?? START_VIEW), padding: { left: 0, right: 0, top: 0, bottom: 0 }, duration });
      saved = null;
      return;
    }
    const v = STEP_VIEW[target];
    const { mode } = territoireStore.getState();
    const card = stepSelection(target, mode, aqueducStore.getState().scenario.valvesClosed) !== null;
    const onCut = v.on === "cut" && cut !== null;
    const center: [number, number] = onCut ? [(cut.from[0] + cut.to[0]) / 2, (cut.from[1] + cut.to[1]) / 2] : brk;
    map.easeTo({
      center,
      zoom: wide ? v.zoom : v.zoom - 0.8,
      pitch: v.pitch,
      bearing: onCut ? faceBearing(cut.from, cut.to) + v.bearing : v.bearing,
      duration,
      padding: wide
        ? { left: STORY_W + GAP, right: card ? INSPECTOR_W + GAP : 0, top: 0, bottom: TIMELINE_H + GAP }
        : { left: 0, right: 0, top: 0, bottom: 0 },
    });
  };
}

/** Élément de la carte sous le pointeur : capteur, puis conduite (les secteurs et étiquettes sont du HTML). */
function pick(map: MlMap, x: number, y: number): Selection {
  const pad = 5;
  const found = map.queryRenderedFeatures(
    [
      [x - pad, y - pad],
      [x + pad, y + pad],
    ],
    { layers: PICK_LAYERS },
  );
  const by = (id: string) => found.find((f: MapGeoJSONFeature) => f.layer.id === id);
  const sensor = by("aq-sensors");
  if (sensor) return { kind: "sensor", id: String(sensor.properties.id) };
  const pipe = by("aq-pipes");
  if (pipe) {
    const id = String(pipe.properties.id);
    const { incident } = aqueducStore.getState();
    return { kind: incident && id === CITY.breakSegment ? "incident" : "segment", id };
  }
  return null;
}

/** Reporte l'état du store sur la carte (hors React : une fois par message du flux). */
function syncMap(map: MlMap, net: NetIndex, s: AqState, prev: AqState | null) {
  if (!prev || s.layer !== prev.layer) setPipeLayer(map, s.layer);
  if (!prev || s.live !== prev.live) {
    setPipeValues(map, "pression", s.live.pressure);
    setPipeValues(map, "qualite", s.live.chlorine);
    setSensorStatus(map, net.data.sensors, s.live.readings);
  }
  if (!prev || s.selection !== prev.selection) {
    const sel = s.selection;
    markSegment(map, "sel", sel && (sel.kind === "segment" || sel.kind === "incident") ? (net.segById.get(sel.id) ?? null) : null);
  }
  if (!prev || s.incident !== prev.incident) markSegment(map, "inc", s.incident ? (net.segById.get(CITY.breakSegment) ?? null) : null);
}

/**
 * Élément mis en avant pour l'aqueduc (alerte, recherche) : sélectionné, caméra amenée dessus, puis
 * effacé. Lu au montage (on arrive d'un autre environnement) et à chaque changement.
 */
function attachFocus(map: MlMap, net: NetIndex): () => void {
  const apply = (f: Focus) => {
    if (!f || f.env !== "aqueduc") return;
    setFocus(null);
    const at = selectionCenter(net, f.kind, f.id);
    if (!at) return;
    // l'incident n'existe qu'après le bris de 14:00 : avant, c'est le tronçon
    const kind = f.kind === "incident" && !aqueducStore.getState().incident ? "segment" : f.kind;
    select({ kind, id: f.id });
    map.easeTo({ center: at, zoom: Math.max(map.getZoom(), 16.2), duration: 1200 });
  };
  apply(territoireStore.getState().focus);
  return territoireStore.subscribe((s, prev) => s.focus !== prev.focus && apply(s.focus));
}

/** Monte l'aqueduc sur la carte ; renvoie la couche des tubes (pilotage, mesures) et le démontage. */
export function mountAqueduc(map: MlMap, metrics: Metrics, net: NetIndex): { tubes: TubeLayer; unmount(): void } {
  applyPipeLayers(map, net.data, aqueducStore.getState().layer);

  const onClick = (e: MapMouseEvent) => select(pick(map, e.point.x, e.point.y));
  const enter = () => void (map.getCanvas().style.cursor = "pointer");
  const leave = () => void (map.getCanvas().style.cursor = "");
  map.on("click", onClick);
  for (const id of PICK_LAYERS) {
    map.on("mouseenter", id, enter);
    map.on("mouseleave", id, leave);
  }

  // --- store → carte
  syncMap(map, net, aqueducStore.getState(), null);
  const offMap = aqueducStore.subscribe((s, prev) => {
    const t = performance.now();
    syncMap(map, net, s, prev);
    metrics.addWork(performance.now() - t);
  });

  // --- re-rendus des étiquettes comptés comme mises à jour de données
  // (lot commencé pendant le traitement d'un message du flux : déjà compté dans ce message)
  setTagWorkSink((ms, start) => metrics.update(ms, start));

  // --- vue souterraine : tubes 3D sous la rue, fond estompé
  const under = attachUnderground(map, net, (ms) => metrics.addWork(ms));

  // --- scénario de bris : vannes du plan d'isolation (serveur) et caméra ; l'incident suit l'horloge
  // commune et les actions, et le passage du temps (bris de 14:00, vannes fermées par l'équipe…)
  const detachScenario = attachScenario({ valves: net.data.scenario.valves, camera: scenarioCamera(map, net) });
  const tick = setInterval(() => syncIncident(), 1000);

  // --- flux des capteurs (après l'incident : la première URL le porte déjà)
  const closeStream = attachStream(metrics);
  const offFocus = attachFocus(map, net);

  // --- API de pilotage (vérifications de bout en bout, banc)
  const w = window as unknown as Record<string, unknown>;
  w.__aqueduc = {
    map,
    metrics,
    store: aqueducStore,
    /** état commun de la ville : horloge, mode, API, actions */
    territoire: territoireStore,
    net,
    tubes: under.layer,
    scenario: { start: startScenario, goTo: goToStep, explore: exploreFreely },
    /** banc (R7) : n étiquettes (capteurs réels de la zone, puis points simulés) ; null : usage normal */
    setTags: (n: number | null) => aqueducStore.setState({ benchTags: n === null ? null : Math.max(0, Math.floor(n)) }),
    /** banc : lance le scénario au besoin et va à l'étape ; « close » ferme les vannes (serveur) */
    play: (step: StepId | "close") => {
      if (step === "close") return closeValves();
      if (!aqueducStore.getState().scenario.active) {
        startScenario();
        if (step === "detection") return;
      }
      goToStep(step);
    },
  };

  return {
    tubes: under.layer,
    unmount() {
      offFocus();
      closeStream();
      clearInterval(tick);
      // quitter l'aqueduc termine le scénario guidé, sans caméra (la scène vole vers l'environnement
      // suivant) : horloge, couche et vue quittées rendues, isolation décidée gardée
      detachScenario();
      exploreFreely();
      select(null);
      under.detach();
      offMap();
      setTagWorkSink(null);
      map.off("click", onClick);
      for (const id of PICK_LAYERS) {
        map.off("mouseenter", id, enter);
        map.off("mouseleave", id, leave);
      }
      map.getCanvas().style.cursor = "";
      removePipeLayers(map);
      delete w.__aqueduc;
    },
  };
}
