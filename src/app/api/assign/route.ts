/** Lecture des responsables et des assignations (écriture : Server Action `assignAction`). */
import { listAssignments, listManagers } from "@/server/repo";
import { json } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET() {
  const [managers, assignments] = await Promise.all([listManagers(), listAssignments()]);
  return json({ managers, assignments });
}
