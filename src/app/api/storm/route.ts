/** « Tempête » : 30 % des cartes changent en même temps. */
import { getBranches } from "@/lib/sim/catalog";
import { stormChanges } from "@/lib/sim/generators";
import { json, readParams } from "@/server/params";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const { n, seed } = readParams(req);
  const s = seed || Date.now() >>> 0;
  return json({ seed: s, changes: stormChanges(getBranches(n), s, 0.3) });
}
