import { readFileSync } from "node:fs";
import { decodeNetwork, type Network, type RawNetwork } from "../src/lib/aqueduc/network";

/** Charge le JSON brut du réseau réel. */
export function loadRaw(): RawNetwork {
  return JSON.parse(readFileSync("data/aqueduc/trois-rivieres.json", "utf8")) as RawNetwork;
}

/** Réseau décodé (mis en cache : le fichier est lu une seule fois par processus). */
let cache: Network | null = null;
export function loadNetwork(): Network {
  return (cache ??= decodeNetwork(loadRaw()));
}
