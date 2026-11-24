import { CARD_H, CARD_W, MID_SCALE } from "@/lib/world";

/** Taille CSS de l'élément HTML selon le niveau (1 = intermédiaire, 2 = rapproché). */
export const CARD_CSS = {
  1: { w: Math.round(CARD_W * MID_SCALE), h: Math.round(CARD_H * MID_SCALE) },
  2: { w: CARD_W, h: CARD_H },
} as const;

/**
 * Zone réservée à la sparkline (px CSS dans l'élément du niveau). En mode DOM elle contient
 * un SVG ; en mode HTML-in-Canvas elle reste vide et WebGL dessine la courbe par-dessus la
 * texture : un nouveau point ne déclenche donc jamais de recapture.
 */
export const SPARK_ZONE = {
  1: { x: 9, y: 78, w: CARD_CSS[1].w - 18, h: CARD_CSS[1].h - 86 },
  2: { x: 12, y: 92, w: CARD_W - 24, h: 46 },
} as const;
