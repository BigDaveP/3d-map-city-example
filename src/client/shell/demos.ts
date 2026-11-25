/** Données de navigation : pas d'import React, utilisables côté serveur, client et tests. */
export type PageId = "aqueduc" | "bench";

/** Les deux pages : la démo et son banc de mesures. La barre de chacune renvoie à l'autre. */
export const PAGES: Record<PageId, { href: string; title: string }> = {
  aqueduc: { href: "/", title: "Réseau d'eau" },
  bench: { href: "/bench", title: "Banc de mesures" },
};

/** Page vers laquelle renvoie la barre de `current`. */
export const otherPage = (current: PageId): PageId => (current === "aqueduc" ? "bench" : "aqueduc");

export const ABOUT: Record<PageId, { looking: string; simulated: string; tryIt: [string, string, string] }> = {
  aqueduc: {
    looking: "Le réseau réel de conduites de Trois-Rivières, avec ses secteurs, ses capteurs de pression et de débit et ses vannes.",
    simulated: "Simulation : les mesures des capteurs, les débits des secteurs et le bris de conduite sont générés ; seul le tracé des conduites est réel.",
    tryIt: ["Cliquer sur une conduite pour ouvrir sa fiche.", "Changer de couche pour colorer le réseau autrement.", "Lancer le scénario de bris et suivre le récit."],
  },
  bench: {
    looking: "Les résultats du banc qui rejoue la démo réseau d'eau en mode classique (marqueurs DOM) et en HTML-in-Canvas : rotation, horloge accélérée, scénario.",
    simulated: "Les capteurs et leurs mesures sont simulés ; les mesures de performance, elles, sont réelles mais prises sur la machine décrite sur la page, sans GPU.",
    tryIt: ["Lire les graphiques par nombre d'étiquettes.", "Comparer la vue souterraine à la vue normale dans le dernier tableau.", "Télécharger le CSV pour refaire les calculs."],
  },
};
