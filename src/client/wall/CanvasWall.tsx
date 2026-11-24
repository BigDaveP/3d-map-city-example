"use client";
import { useEffect } from "react";
import type { Level, WorldLayout } from "@/lib/world";
import type { Camera } from "../camera";
import type { Metrics } from "../metrics";
import type { DataStore } from "../store";
import type { FrameLoop } from "./frame";

export interface CanvasWallProps {
  ds: DataStore;
  camera: Camera;
  loop: FrameLoop;
  metrics: Metrics;
  layout: WorldLayout;
  level: Level;
  onFallback(reason: string): void;
}

/** Implémenté à l'étape 3. */
export function CanvasWall({ onFallback }: CanvasWallProps) {
  useEffect(() => onFallback("mode HTML-in-Canvas pas encore implémenté"), [onFallback]);
  return null;
}
