/**
 * Pictogrammes de l'outil, des environnements et de l'interface (traits de 1,5, extrémités rondes,
 * couleur héritée du texte), dessinés ici : aucun logo de tiers. Une seule famille, deux tailles :
 * 16 dans les listes et le texte, 18 dans la barre.
 */
import type { EnvId } from "@/lib/territoire/envs";

const STROKE = 1.5;

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

export function EnvIcon({ env, size = 16 }: { env: EnvId; size?: number }) {
  return (
    <svg className="tr-icon" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[env]} />
    </svg>
  );
}

const UI = {
  bell: "M5 8.5a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12.5 5 8.5ZM8.3 16.5a1.8 1.8 0 0 0 3.4 0",
  info: "M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15ZM10 9v4.5M10 6.4v.1",
  search: "M8.5 3a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11ZM13 13l4 4",
  close: "M5 5l10 10M15 5 5 15",
  "chevron-right": "m8 5 5 5-5 5",
  "chevron-down": "m5 8 5 5 5-5",
  "arrow-left": "M16 10H4M9 5l-5 5 5 5",
  updown: "m6.5 7.5 3.5-3.5 3.5 3.5M6.5 12.5l3.5 3.5 3.5-3.5",
  check: "M10 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15ZM6.8 10.2l2.2 2.2 4.2-4.6",
} as const;

export type UiIconName = keyof typeof UI;

/** Pictogramme d'interface (décoratif : le nom accessible est sur le bouton ou le lien). */
export function UiIcon({ name, size = 16 }: { name: UiIconName; size?: number }) {
  return (
    <svg className="tr-ui-i" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={UI[name]} />
    </svg>
  );
}

/** Marque de l'outil : couches de carte superposées, à plat (aucun logo de ville). */
export function BrandMark() {
  return (
    <span className="tr-brand-mark" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={STROKE} strokeLinecap="round" strokeLinejoin="round">
        <path d="m10 3 7 3.8-7 3.8-7-3.8L10 3Z" />
        <path d="m3 10.2 7 3.8 7-3.8M3 13.6l7 3.8 7-3.8" />
      </svg>
    </span>
  );
}
