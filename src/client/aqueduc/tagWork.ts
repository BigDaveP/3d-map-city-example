/**
 * Coût JS d'un lot de re-rendus d'étiquettes (valeur affichée changée, au plus toutes les 2 s par
 * étiquette) : du rendu de la première étiquette du lot au commit de la dernière, dans la même tâche
 * (mise à jour React par défaut, sans découpage). Mêmes composants dans les deux modes ; le banc
 * l'ajoute au travail des mises à jour (`Metrics.update`). Module sans React, sans état par visiteur
 * autre que le lot en cours.
 */
let start = 0;
let end = 0;
let sink: ((ms: number, start: number) => void) | null = null;

/** Destination des mesures (null : rien n'est mesuré). */
export function setTagWorkSink(fn: ((ms: number, start: number) => void) | null) {
  sink = fn;
}

/** Au rendu d'une étiquette dont la valeur affichée change. */
export function tagRenderStart() {
  if (!sink || start) return;
  start = performance.now();
  // après le commit synchrone du lot (rendu, mutations du DOM, effets de mise en page)
  queueMicrotask(flush);
}

/** À l'effet de mise en page de cette étiquette (commit). */
export function tagCommitted() {
  if (start) end = performance.now();
}

function flush() {
  if (sink && end > start) sink(end - start, start);
  start = 0;
  end = 0;
}
