/** Source « polling » (60 s) : instantané complet au tick demandé, sans état côté serveur. */
import { getBranches } from "@/lib/sim/catalog";
import { staffAt } from "@/lib/sim/generators";
import { json, readParams } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { n, tick } = readParams(req);
  return json({ tick, data: getBranches(n).map((b) => staffAt(b, tick)) });
}
