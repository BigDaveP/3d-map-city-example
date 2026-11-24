"use client";
import type { Map as MlMap } from "maplibre-gl";
import type { Metrics } from "../metrics";

type ML = typeof import("maplibre-gl");

/** Étape 2. */
export function HicPanels(_: { ml: ML; map: MlMap; metrics: Metrics; onFallback(reason: string): void }) {
  return null;
}
