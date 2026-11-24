"use client";
import type { Map as MlMap } from "maplibre-gl";
import { useStore } from "zustand";
import { CITIES, type CityId } from "@/lib/carte/catalog";
import { carteStore } from "./store";

export function CarteToolbar({ map }: { map: MlMap | null }) {
  const s = useStore(carteStore);
  const set = carteStore.setState;
  const openAll = (n: number) => (window as unknown as { __carte?: { openPanels(r: number, c: number): void } }).__carte?.openPanels(Math.min(15, n), Math.max(0, n - 15));
  return (
    <div className="toolbar" role="toolbar" aria-label="Commandes de la carte">
      <div className="grp" role="group" aria-label="Mode des panneaux">
        <button type="button" aria-pressed={s.mode === "classic"} onClick={() => set({ mode: "classic", fallback: "" })}>
          Classique (DOM)
        </button>
        <button type="button" aria-pressed={s.mode === "hic"} onClick={() => set({ mode: "hic", fallback: "" })} disabled={s.api === "absente"}>
          HTML-in-Canvas
        </button>
      </div>
      <span className={`badge ${s.api}`} title={s.apiDetail} data-testid="api-badge">
        API {s.api === "active" ? "active et vérifiée" : s.api}
      </span>
      <label>
        Ville
        <select value={s.city} onChange={(e) => set({ city: e.currentTarget.value as CityId, openRestaurants: [], openCouriers: [] })}>
          {Object.values(CITIES).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="grp" role="group" aria-label="Orientation des panneaux">
        <button type="button" aria-pressed={s.orientation === "billboard"} onClick={() => set({ orientation: "billboard" })}>
          Face caméra
        </button>
        <button type="button" aria-pressed={s.orientation === "facade"} onClick={() => set({ orientation: "facade" })}>
          Sur façade
        </button>
      </div>
      <label>
        <input type="checkbox" checked={s.fog} onChange={(e) => set({ fog: e.currentTarget.checked })} /> Brouillard
      </label>
      <label>
        <input type="checkbox" checked={s.shadow} onChange={(e) => set({ shadow: e.currentTarget.checked })} /> Ombre
      </label>
      <label>
        <input type="checkbox" checked={s.pulse} onChange={(e) => set({ pulse: e.currentTarget.checked })} /> Pulsations
      </label>
      <label>
        Ouverture
        <select value={s.transition} onChange={(e) => set({ transition: e.currentTarget.value as typeof s.transition })}>
          <option value="dissolve">dissolution</option>
          <option value="sweep">balayage</option>
          <option value="none">aucune</option>
        </select>
      </label>
      <div className="grp" role="group" aria-label="Ouvrir des panneaux">
        {[10, 30].map((n) => (
          <button key={n} type="button" onClick={() => openAll(n)}>
            {n} panneaux
          </button>
        ))}
        <button type="button" onClick={() => set({ openRestaurants: [], openCouriers: [] })}>
          Tout fermer
        </button>
      </div>
      <button type="button" id="export-video" disabled={!map || s.recording === "enregistrement"} data-recording={s.recording}>
        {s.recording === "enregistrement" ? "Enregistrement…" : "Exporter 10 s de vidéo"}
      </button>
      <button type="button" aria-pressed={s.robotOpen} onClick={() => set({ robotOpen: !s.robotOpen })}>
        Voir ce que voit un robot
      </button>
      <span className="badge" title="Persistance">
        {s.persistence}
      </span>
    </div>
  );
}
