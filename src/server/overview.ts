/** Vue d'ensemble calculée côté serveur (état initial déterministe, tick 0) pour le SSR. */
import "server-only";
import { getBranches, REGIONS } from "@/lib/sim/catalog";
import { initialSales, reviewsAt, staffAt, weatherAt } from "@/lib/sim/generators";
import { reviewsStatus, salesStatus, staffStatus, weatherStatus } from "@/lib/sim/status";
import { KIND_LABEL, type Alert, type Kind, type Status } from "@/lib/sim/types";
import { listAlerts } from "./repo";

export interface RegionOverview {
  id: string;
  name: string;
  branches: number;
  cards: number;
  critical: number;
  attention: number;
}

export async function getOverview(n: number) {
  const branches = getBranches(n);
  const regions: RegionOverview[] = REGIONS.map((r) => ({ id: r.id, name: r.name, branches: 0, cards: 0, critical: 0, attention: 0 }));
  const auto: { branch: string; kind: Kind; label: string }[] = [];
  for (const b of branches) {
    const st: [Kind, Status][] = [
      ["sales", salesStatus(initialSales(b))],
      ["staff", staffStatus(staffAt(b, 0))],
      ["reviews", reviewsStatus(reviewsAt(b, 0))],
      ["weather", weatherStatus(weatherAt(b, 0))],
    ];
    const reg = regions[b.regionIdx];
    reg.branches++;
    reg.cards += 5;
    const crit = st.filter(([, s]) => s === 2).length;
    // carte « alertes » : critique dès qu'un autre indicateur l'est
    reg.critical += crit;
    reg.attention += st.filter(([, s]) => s === 1).length + (crit ? 1 : 0);
    for (const [k, s] of st) if (s === 2) auto.push({ branch: b.name, kind: k, label: KIND_LABEL[k] });
  }
  let manual: Alert[] = [];
  try {
    manual = (await listAlerts()).filter((a) => branches.some((b) => b.id === a.branchId)).slice(0, 20);
  } catch {}
  const nameOf = new Map(branches.map((b) => [b.id, b.name]));
  return {
    regions,
    totals: {
      cards: branches.length * 5,
      critical: regions.reduce((a, r) => a + r.critical, 0),
      attention: regions.reduce((a, r) => a + r.attention, 0),
    },
    manual: manual.map((a) => ({ ...a, branchName: nameOf.get(a.branchId) ?? a.branchId })),
    auto: auto.slice(0, 40),
    autoTotal: auto.length,
  };
}
