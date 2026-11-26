/** Zones de stationnement de nuit (réelles), feux d'interdiction et ressources (simulés) : données statiques. */
import { getDeneigementData } from "@/server/territoire/deneigement";

export const dynamic = "force-static";

export async function GET() {
  return Response.json(getDeneigementData());
}
