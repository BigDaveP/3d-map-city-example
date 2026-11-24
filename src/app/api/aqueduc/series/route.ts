/**
 * Courbe de 24 h pour la frise (Simulation) : 96 points de 15 min, de minuit à minuit (heure de l'Est),
 * pour la journée simulée qui contient `t`. Le modèle est déterministe : la journée entière se calcule.
 * ?t=<ms sim>&sel=<sensor:P-01|sector:centre-ville|segment:13C1949>&inc&closed&restored (comme le flux)
 * Sans `sel` : débit total distribué (somme des secteurs).
 * Réponse : { label, unit, from, step, values }
 */
import { dayStart, SENSOR_KIND } from "@/client/aqueduc/format";
import { readingsAt, sectorStats, segmentValues } from "@/lib/aqueduc/sim";
import { getModel, incidentFromQuery, numParam } from "@/server/aqueduc";

export const dynamic = "force-dynamic";

const STEP = 900_000;
const N = 96;
const r2 = (x: number) => Math.round(x * 100) / 100;
const bad = () => new Response("Paramètres invalides", { status: 400 });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const t = numParam(q.get("t"));
  const incident = incidentFromQuery(q);
  if (t === undefined || incident === undefined) return bad();
  const m = getModel();
  const from = dayStart(t ?? Date.now());
  const times = Array.from({ length: N }, (_, i) => from + i * STEP);
  const sel = q.get("sel");
  const [kind, id] = sel ? [sel.slice(0, sel.indexOf(":")), sel.slice(sel.indexOf(":") + 1)] : ["total", ""];

  let label: string;
  let unit: string;
  let values: number[];
  if (kind === "total") {
    label = "Débit total distribué";
    unit = "L/s";
    values = times.map((x) => r2(sectorStats(m, x, incident).reduce((a, s) => a + s.flowLs, 0)));
  } else if (kind === "sector") {
    const k = m.sectors.findIndex((s) => s.id === id);
    if (k < 0) return bad();
    label = `Débit entrant · ${m.sectors[k].name}`;
    unit = "L/s";
    values = times.map((x) => sectorStats(m, x, incident)[k].flowLs);
  } else if (kind === "sensor") {
    const s = m.sensors.find((x) => x.id === id);
    if (!s) return bad();
    const first = readingsAt(m, from, incident)[s.idx];
    label = `${SENSOR_KIND[s.kind].measure} · ${s.id}`;
    unit = first.unit;
    values = times.map((x) => readingsAt(m, x, incident)[s.idx].value);
  } else if (kind === "segment" || kind === "incident") {
    const si = m.network.byId.get(id);
    if (si === undefined) return bad();
    label = `Pression · ${id}`;
    unit = "bar";
    values = times.map((x) => r2(segmentValues(m, x, incident, "pression")[si]));
  } else return bad();

  return Response.json({ label, unit, from, step: STEP, values }, { headers: { "cache-control": "no-store" } });
}
