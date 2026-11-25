/** Données de navigation : pas d'import React, utilisables côté serveur, client et tests. */
export type DemoId = "aqueduc" | "mur" | "bench";

export const DEMOS: { id: DemoId; href: string; title: string; sentence: string }[] = [
  { id: "aqueduc", href: "/", title: "Réseau d'eau", sentence: "Les conduites d'aqueduc de Trois-Rivières en 3D, avec capteurs, secteurs et scénario de bris simulés." },
  { id: "mur", href: "/mur", title: "Mur de supervision", sentence: "Un millier de cartes HTML en direct, en DOM virtualisé ou dessinées dans un canvas WebGL2 (HTML-in-Canvas)." },
  { id: "bench", href: "/bench", title: "Banc de mesures", sentence: "Les mesures comparant le DOM virtualisé et HTML-in-Canvas : FPS, latence, captures, mémoire." },
];

export const ABOUT: Record<DemoId, { looking: string; simulated: string; tryIt: [string, string, string] }> = {
  aqueduc: {
    looking: "Le réseau réel de conduites de Trois-Rivières, avec ses secteurs, ses capteurs de pression et de débit et ses vannes.",
    simulated: "Simulation : les mesures des capteurs, les débits des secteurs et le bris de conduite sont générés ; seul le tracé des conduites est réel.",
    tryIt: ["Cliquer sur une conduite pour ouvrir sa fiche.", "Changer de couche pour colorer le réseau autrement.", "Lancer le scénario de bris et suivre le récit."],
  },
  mur: {
    looking: "Un mur de cartes de succursales, chacune avec ses indicateurs, regroupées par région.",
    simulated: "Simulation : succursales, chiffres, avis et responsables sont fictifs et changent en continu.",
    tryIt: ["Basculer entre le mode DOM et le mode canvas.", "Zoomer sur une région puis sur une carte.", "Déclencher la tempête pour recapturer de nombreuses cartes."],
  },
  bench: {
    looking: "Les résultats du banc qui rejoue le même parcours en DOM virtualisé et en HTML-in-Canvas.",
    simulated: "Les données du mur sont simulées ; les mesures, elles, sont réelles mais prises sur la machine décrite sur la page, sans GPU.",
    tryIt: ["Lire les graphiques par nombre de cartes.", "Ouvrir les tableaux détaillés.", "Télécharger le CSV pour refaire les calculs."],
  },
};
