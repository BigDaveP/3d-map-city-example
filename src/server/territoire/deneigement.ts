/** Données du déneigement : zones réelles, feux et ressources simulés. Lues une fois, puis mémorisées. */
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FLEET } from "@/lib/territoire/fleet";
import type { DeneigementData, Light, Zone } from "@/lib/territoire/neige";

export type { DeneigementData, Light, Zone } from "@/lib/territoire/neige";

const g = globalThis as unknown as { __deneigementData?: DeneigementData };

const read = <T>(f: string): T => JSON.parse(readFileSync(path.join(process.cwd(), "data", "territoire", f), "utf8")) as T;

export function getDeneigementData(): DeneigementData {
  return (g.__deneigementData ??= {
    zones: read<{ zones: Zone[] }>("stationnement-nuit.json").zones,
    lights: read<{ lights: Light[] }>("feux.json").lights,
    fleet: FLEET,
  });
}
