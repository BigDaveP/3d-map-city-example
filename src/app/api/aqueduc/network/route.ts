/** Réseau réel complet (GeoJSON), capteurs simulés, secteurs, vannes et ordre des segments du flux. */
import { CITY } from "@/lib/aqueduc/city";
import { getDemoSegments, getModel } from "@/server/aqueduc";

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
      properties: { i: s.idx, id: s.id, d: s.diameter, m: s.material, y: s.year, c: s.cls, s: m.sectors[m.sectorOf[s.idx]].id },
    };
  });
  const nodePos = (node: number): [number, number] => {
    const s = n.segments[n.adj[node][0]];
    const k = s.a === node ? 0 : s.coords.length - 2;
    return [r6(s.coords[k]), r6(s.coords[k + 1])];
  };
  const body = {
    segments: { type: "FeatureCollection", features },
    demoSegments: getDemoSegments(),
    sensors: m.sensors,
    sectors: m.sectors.map((s, k) => ({ id: s.id, name: s.name, addresses: s.addresses, at: CITY.sectorSeeds[k].at })),
    valves: [...m.valves].sort((a, b) => a - b).map((node) => ({ node, at: nodePos(node) })),
    attribution: CITY.attribution,
  };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=86400" },
  });
}
