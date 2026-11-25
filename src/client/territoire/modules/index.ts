/**
 * Modules d'environnement, chargés à la demande (import dynamique : le code et les données d'un
 * environnement ne sont téléchargés qu'à son ouverture). Les environnements du lot 2 n'en ont pas
 * encore (« À venir »).
 */
import type { EnvId } from "@/lib/territoire/envs";
import type { EnvModule } from "./types";

export const MODULES: Partial<Record<EnvId, () => Promise<EnvModule>>> = {
  aqueduc: () => import("./aqueduc").then((m) => m.loadAqueduc()),
  deneigement: () => import("./deneigement").then((m) => m.deneigement),
};

const loading = new Map<EnvId, Promise<EnvModule>>();
const ready = new Map<EnvId, EnvModule>();

/**
 * Module de `id`, chargé une fois par page (un échec n'est pas retenu : le prochain appel
 * réessaie) ; null si l'environnement n'a pas de module.
 */
export function loadModule(id: EnvId): Promise<EnvModule> | null {
  const load = MODULES[id];
  if (!load) return null;
  let p = loading.get(id);
  if (!p) {
    p = load().then(
      (m) => (ready.set(id, m), m),
      (e: unknown) => {
        loading.delete(id);
        throw e;
      },
    );
    loading.set(id, p);
  }
  return p;
}

/** Modules déjà chargés (recherche : conduites et capteurs dès que l'aqueduc a été ouvert). */
export const loadedModules = (): EnvModule[] => [...ready.values()];
