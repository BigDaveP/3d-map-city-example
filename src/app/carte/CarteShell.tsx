"use client";
/** Carte montée après l'hydratation (ssr: false) : MapLibre et WebGL n'existent pas côté serveur. */
import dynamic from "next/dynamic";
import type { CityId } from "@/lib/carte/catalog";
import type { CarteMode } from "@/client/carte/store";

const CarteApp = dynamic(() => import("@/client/carte/CarteApp"), { ssr: false, loading: () => <p className="noscript">Chargement de la carte…</p> });

export default function CarteShell({ mode, city }: { mode?: CarteMode; city?: CityId }) {
  return <CarteApp initialMode={mode} initialCity={city} />;
}
