/**
 * Réseau réel complet (GeoJSON), capteurs simulés, secteurs, vannes, ordre des segments du flux et
 * plan d'isolation du tronçon du scénario (vannes à fermer, calculées ici : le client n'a pas le modèle).
 * Propriétés : i (index), id, d (mm), m (matériau), y (année), c (classe), s (secteur), l (longueur en m,
 * donnée source), b (bris antérieurs simulés depuis 2009).
 * `extraTags` : points de mesure supplémentaires, simulés, réservés au banc (`setTags`, R7).
 */
import { CITY } from "@/lib/aqueduc/city";
import { isolate, isolationPath } from "@/lib/aqueduc/graph";
import { SCENARIO_STEPS, scenarioIncident } from "@/lib/aqueduc/scenario";
import { breakHistory, incidentImpact } from "@/lib/aqueduc/sim";
import { getDemoSegments, getExtraTagNodes, getModel } from "@/server/aqueduc";

export const dynamic = "force-static";

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export async function GET() {
  const m = getModel();
  const n = m.network;
  const features = n.segments.map((s) => {
    const coordinates: [number, number][] = [];
    for (let i = 0; i < s.coords.length; i += 2) coordinates.push([r6(s.coords[i]), r6(s.coords[i + 1])]);
    return {
      type: "Feature" as const,
      geometry: { type: "LineString" as const, coordinates },
      properties: { i: s.idx, id: s.id, d: s.diameter, m: s.material, y: s.year, c: s.cls, s: m.sectors[m.sectorOf[s.idx]].id, l: s.length, b: breakHistory(m, s.idx) },
    };
  });
  const nodePos = (node: number): [number, number] => {
    const s = n.segments[n.adj[node][0]];
    const k = s.a === node ? 0 : s.coords.length - 2;
    return [r6(s.coords[k]), r6(s.coords[k + 1])];
  };
  // scénario de bris : vannes qui isolent le tronçon et adresses touchées à l'isolation, vannes ouvertes puis fermées
  const brk = n.byId.get(CITY.breakSegment)!;
  const iso = isolate(n, brk, m.valves);
  const at = SCENARIO_STEPS.find((s) => s.id === "isolation")!.at;
  const scenario = {
    segment: CITY.breakSegment,
    valves: iso.valves,
    isolated: iso.isolated,
    path: isolationPath(n, iso),
    impact: {
      lowPressure: incidentImpact(m, at, scenarioIncident("isolation", false, m)).lowPressureAddresses,
      withoutWater: incidentImpact(m, at, scenarioIncident("isolation", true, m)).withoutWaterAddresses,
    },
  };
  const body = {
    segments: { type: "FeatureCollection", features },
    demoSegments: getDemoSegments(),
    sensors: m.sensors,
    sectors: m.sectors.map((s, k) => ({ id: s.id, name: s.name, addresses: s.addresses, at: CITY.sectorSeeds[k].at })),
    valves: [...m.valves].sort((a, b) => a - b).map((node) => ({ node, at: nodePos(node) })),
    scenario,
    extraTags: getExtraTagNodes().map((node, k) => ({ id: `X-${String(k + 1).padStart(3, "0")}`, node, at: nodePos(node) })),
    attribution: CITY.attribution,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
