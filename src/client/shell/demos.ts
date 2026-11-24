/** Données de navigation : pas d'import React, utilisables côté serveur, client et tests. */
export type DemoId = "aqueduc" | "mur" | "carte" | "bench";

export const DEMOS: { id: DemoId; href: string; title: string; sentence: string }[] = [
  { id: "aqueduc", href: "/", title: "Réseau d'eau", sentence: "Les conduites d'aqueduc de Trois-Rivières en 3D, avec capteurs, secteurs et scénario de bris simulés." },
  { id: "mur", href: "/mur", title: "Mur de supervision", sentence: "Un millier de cartes HTML en direct, en DOM virtualisé ou dessinées dans un canvas WebGL2 (HTML-in-Canvas)." },
  { id: "carte", href: "/carte", title: "Livraison 3D", sentence: "Une carte 3D de restaurants et de livreurs simulés dont les étiquettes HTML sont rendues dans la scène." },
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
  carte: {
    looking: "Une carte 3D de Québec et de Montréal avec des restaurants, des livreurs et des commandes.",
    simulated: "Simulation : restaurants, livreurs et commandes sont fictifs ; seules les positions se trouvent dans des quartiers réels.",
    tryIt: ["Cliquer sur un restaurant pour voir son détail.", "Passer de Québec à Montréal.", "Comparer le mode classique et le mode HTML-in-Canvas."],
  },
  bench: {
    looking: "Les résultats du banc qui rejoue le même parcours en DOM virtualisé et en HTML-in-Canvas.",
    simulated: "Les données du mur sont simulées ; les mesures, elles, sont réelles mais prises sur la machine décrite sur la page, sans GPU.",
    tryIt: ["Lire les graphiques par nombre de cartes.", "Ouvrir les tableaux détaillés.", "Télécharger le CSV pour refaire les calculs."],
  },
};
