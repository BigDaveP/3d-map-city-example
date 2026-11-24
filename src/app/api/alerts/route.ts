import { listAlerts } from "@/server/repo";
import { json } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ alerts: await listAlerts() });
}
