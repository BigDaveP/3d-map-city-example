"use client";
/**
 * Environnement Aqueduc : la démo du réseau d'eau branchée sur l'interface de module. Le chargement
 * attend le réseau (`/api/aqueduc/network`) ; le reste réutilise `src/client/aqueduc/*` : couches
 * et abonnements (`mountAqueduc`), inscriptions de la scène (HTML-in-Canvas ou classique), panneau
 * (couches, scénario, récit), fiche et part de la frise.
 */
import { useEffect, useState } from "react";
import { CITY, SIM_CREDIT } from "@/lib/aqueduc/city";
import type { SearchHit } from "@/lib/territoire/search";
import { ClassicScene } from "../../aqueduc/classic/ClassicScene";
import { mountAqueduc, START_VIEW } from "../../aqueduc/mount";
import { fold, indexNetwork, type NetIndex } from "../../aqueduc/net";
import type { NetworkData } from "../../aqueduc/pipes";
import { SceneSurfaces } from "../../aqueduc/scene/Surfaces";
import type { TubeLayer } from "../../aqueduc/scene/tubes";
import { Inspector as AqInspector } from "../../aqueduc/ui/Inspector";
import { Layers } from "../../aqueduc/ui/Layers";
import { PerfChip } from "../../aqueduc/ui/PerfChip";
import { Story } from "../../aqueduc/ui/Story";
import { aqueducTimeline } from "../../aqueduc/ui/TimelineTrack";
import { useAq } from "../../aqueduc/useAq";
import { useTerritoire } from "../useTerritoire";
import type { EnvModule, SceneCtx } from "./types";

/** Conduites et capteurs du réseau chargé dont l'identifiant commence par la saisie. */
function search(net: NetIndex, raw: string): SearchHit[] {
  const up = raw.trim().toUpperCase();
  if (fold(raw).length < 2) return [];
  const out: SearchHit[] = [];
  for (const s of net.data.sensors)
    if (s.id.startsWith(up)) out.push({ label: s.id, kind: "Capteur simulé", focus: { env: "aqueduc", kind: "sensor", id: s.id } });
  let n = 0;
  for (const id of net.segById.keys()) {
    if (n >= 6) break;
    if (!id.startsWith(up)) continue;
    n++;
    out.push({ label: id, kind: "Conduite", focus: { env: "aqueduc", kind: "segment", id } });
  }
  return out;
}

/**
 * Puce de performance : seulement avec `?perf=1` ou pendant le banc (étiquettes imposées par
 * `setTags`) ; les indicateurs restent hors de la barre d'application.
 */
function usePerf(): boolean {
  const bench = useAq((s) => s.benchTags !== null);
  const [param, setParam] = useState(false);
  useEffect(() => setParam(new URLSearchParams(location.search).get("perf") === "1"), []);
  return param || bench;
}

/** Charge le réseau puis rend le module (un par page : le chargeur est mémorisé par `loadModule`). */
export async function loadAqueduc(): Promise<EnvModule> {
  const r = await fetch("/api/aqueduc/network");
  if (!r.ok) throw new Error(`Le réseau n'a pas pu être chargé (HTTP ${r.status}).`);
  const net = indexNetwork((await r.json()) as NetworkData);
  // couche des tubes du montage en cours (puce de performance)
  let tubes: TubeLayer | null = null;

  function Scene({ ctx }: { ctx: SceneCtx }) {
    const mode = useTerritoire((s) => s.mode);
    const perf = usePerf();
    return (
      <>
        {mode === "classic" ? <ClassicScene ml={ctx.ml} map={ctx.map} net={net} metrics={ctx.metrics} /> : <SceneSurfaces ml={ctx.ml} map={ctx.map} metrics={ctx.metrics} net={net} />}
        {perf && <PerfChip metrics={ctx.metrics} tubes={tubes?.stats ?? null} />}
      </>
    );
  }
  function Panel({ ctx }: { ctx: SceneCtx }) {
    const scenario = useAq((s) => s.scenario.active);
    return scenario ? <Story map={ctx.map} net={net} /> : <Layers />;
  }
  const Inspector = () => <AqInspector net={net} />;

  return {
    id: "aqueduc",
    camera: START_VIEW,
    attribution: [CITY.attribution.split(" · ")[0], SIM_CREDIT],
    mount({ map, metrics }) {
      const m = mountAqueduc(map, metrics, net);
      tubes = m.tubes;
      return () => {
        m.unmount();
        tubes = null;
      };
    },
    Scene,
    Panel,
    Inspector,
    timeline: aqueducTimeline,
    search: (q) => search(net, q),
  };
}
