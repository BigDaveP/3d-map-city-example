/** Lecture des notes d'équipe (l'écriture passe par la Server Action `saveNoteAction`). */
import { listNotes, persistence } from "@/server/repo";
import { json } from "@/server/params";

export const dynamic = "force-dynamic";

export async function GET() {
  const notes = await listNotes();
  return json({ notes, persistence: persistence() });
}
