import { redirect } from "next/navigation";

/**
 * En attendant l'accueil : `/` mène à la vue 3D de l'aqueduc (redirection temporaire), en gardant
 * `?mode=classic|hic` des anciens liens.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { mode } = await searchParams;
  redirect(mode === "classic" || mode === "hic" ? `/carte/aqueduc?mode=${mode}` : "/carte/aqueduc");
}
