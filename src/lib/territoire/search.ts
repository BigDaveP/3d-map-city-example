/**
 * Recherche de la barre d'application, partie connue sans charger de données (module pur) :
 * secteurs de l'aqueduc, zones de stationnement de nuit et ressources de déneigement. Les conduites
 * et les capteurs s'y ajoutent quand le module de l'aqueduc est chargé (`EnvModule.search`), les rues
 * depuis les tuiles chargées. Aucun géocodeur externe (spec 5.3).
 */
import { CITY } from "../aqueduc/city";
import type { EnvFocus } from "./envs";
import { DEPOTS, FLEET, type ResourceKind } from "./fleet";
import { ZONES } from "./neige";

/** Résultat : libellé, genre lisible (« Capteur · Pression »…) et élément à mettre en avant. */
export interface SearchHit {
  label: string;
  kind: string;
  focus: EnvFocus;
}

/** Sans accents ni casse, pour la recherche. */
export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export const RESOURCE_KIND: Record<ResourceKind, string> = {
  chenillette: "Chenillette",
  niveleuse: "Niveleuse",
  souffleuse: "Souffleuse",
  camion: "Camion",
};

/** Résultats sans données chargées pour la saisie `raw` (deux caractères au moins). */
export function staticHits(raw: string): SearchHit[] {
  const q = fold(raw);
  if (q.length < 2) return [];
  const out: SearchHit[] = [];
  for (const s of CITY.sectorSeeds)
    if (fold(s.name).includes(q)) out.push({ label: s.name, kind: "Secteur de distribution (simulé)", focus: { env: "aqueduc", kind: "sector", id: s.id } });
  for (const z of ZONES)
    if (fold(`Zone ${z}`).includes(q)) out.push({ label: `Zone ${z}`, kind: "Zone de stationnement de nuit", focus: { env: "deneigement", kind: "zone", id: z } });
  for (const r of FLEET) {
    const kind = RESOURCE_KIND[r.kind];
    if (fold(r.id).startsWith(q) || fold(kind).includes(q))
      out.push({ label: r.id, kind: `${kind} · ${DEPOTS[r.depot].name}`, focus: { env: "deneigement", kind: "resource", id: r.id } });
  }
  return out;
}
