"use client";
/**
 * Cadence des surfaces : une donnée simulée ne re-rend pas une surface plus d'une fois toutes les 2 s
 * (au plus une capture par élément toutes les 2 s, RULES.md). Utilisé par les étiquettes de la démo réseau d'eau.
 */
import { useEffect, useRef, useState } from "react";

export const THROTTLE_MS = 2000;

/** Valeur mise à jour au plus une fois par `ms` (front montant immédiat, puis fin de fenêtre). */
export function useThrottled<T>(value: T, ms = THROTTLE_MS): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = last.current + ms - performance.now();
    clearTimeout(pending.current);
    if (wait <= 0) {
      last.current = performance.now();
      setShown(value);
    } else {
      pending.current = setTimeout(() => {
        last.current = performance.now();
        setShown(value);
      }, wait);
    }
    return () => clearTimeout(pending.current);
  }, [value, shown, ms]);
  return shown;
}
