/** Ressources de déneigement (Simulation) : 24 véhicules répartis dans 2 dépôts simulés. */

export type ResourceKind = "chenillette" | "niveleuse" | "souffleuse" | "camion";

export type DepotId = "ouest" | "est";

/** Dépôts simulés, placés dans Trois-Rivières ([lng, lat]) ; ce ne sont pas les garages de la Ville. */
export const DEPOTS: Record<DepotId, { name: string; at: [number, number] }> = {
  ouest: { name: "Dépôt Ouest (simulé)", at: [-72.5785, 46.3665] },
  est: { name: "Dépôt Est (simulé)", at: [-72.4895, 46.3735] },
};

export interface Resource {
  id: string;
  kind: ResourceKind;
  depot: DepotId;
}

const COUNTS: [ResourceKind, string, number][] = [
  ["chenillette", "CH", 8],
  ["niveleuse", "NI", 6],
  ["souffleuse", "SO", 4],
  ["camion", "CA", 6],
];

/** CH-01..08, NI-01..06, SO-01..04, CA-01..06 ; dépôts en alternance, donc 12 ressources chacun. */
export const FLEET: readonly Resource[] = COUNTS.flatMap(([kind, prefix, n]) =>
  Array.from({ length: n }, (_, i): Resource => ({
    id: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    kind,
    depot: i % 2 === 0 ? "ouest" : "est",
  })),
);
