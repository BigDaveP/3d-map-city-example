/** Pictogrammes de l'outil et des environnements (traits, couleur héritée), dessinés ici : aucun logo de tiers. */
import type { EnvId } from "@/lib/territoire/envs";

const PATHS: Record<EnvId, string> = {
  // goutte
  aqueduc: "M10 2.8c2.9 3.6 5 6.5 5 9.2a5 5 0 0 1-10 0c0-2.7 2.1-5.6 5-9.2Z",
  // flocon
  deneigement: "M10 2v16M3.1 6l13.8 8M3.1 14l13.8-8M7.6 3.4 10 5l2.4-1.6M7.6 16.6 10 15l2.4 1.6",
  // bac
  collecte: "M4 6h12M8 6V4h4v2M5.5 6l1 11h7l1-11M8.5 9v5M11.5 9v5",
  // zones
  zonage: "M3 3h6v6H3zM11 3h6v6h-6zM3 11h6v6H3zM11 11h6v6h-6z",
  // lot bâti
  evaluation: "M3 17V8l7-5 7 5v9H3ZM8 17v-5h4v5",
};

export function EnvIcon({ env, size = 18 }: { env: EnvId; size?: number }) {
  return (
    <svg className="tr-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[env]} />
    </svg>
  );
}

/** Marque de l'outil : couches de carte superposées (aucun logo de ville). */
export function BrandMark() {
  return (
    <span className="tr-brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
        <path d="m10 3 7 3.8-7 3.8-7-3.8L10 3Z" />
        <path d="m3 10.2 7 3.8 7-3.8M3 13.6l7 3.8 7-3.8" />
      </svg>
    </span>
  );
}
