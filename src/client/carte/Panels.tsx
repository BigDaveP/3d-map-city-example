"use client";
/**
 * Panneaux HTML de la carte : mêmes composants dans la popup MapLibre (mode classique) et dans
 * le canvas (mode HTML-in-Canvas). Les données affichées passent par `useThrottled` : un panneau
 * ne se re-rend pas plus d'une fois toutes les 2 s pour une donnée simulée ; les actions de
 * l'utilisateur (saisie, interrupteur, boutons) sont immédiates.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { dispatchCourierAction, reassignCourierAction, saveRestaurantNoteAction, setPausedAction } from "@/app/carte/actions";
import { COURIERS, RESTAURANTS } from "@/lib/carte/catalog";
import { carteStore, couriers, toggleCourier, toggleRestaurant, useCarte, type RestaurantView } from "./store";

export const PANEL_SIZE = { restaurant: { w: 300, h: 236 }, courier: { w: 220, h: 132 } } as const;
export const THROTTLE_MS = 2000;

/** Points d'accroche par mode (mesure de latence du mode classique). */
export const panelHooks = { onRestaurantCommit: (_idx: number) => {} };

/** Valeur mise à jour au plus une fois par `ms` (front montant immédiat, puis fin de fenêtre). */
export function useThrottled<T>(value: T, ms = THROTTLE_MS): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (Object.is(value, shown)) return;
    const wait = last.current + ms - performance.now();
    clearTimeout(pending.current);
    if (wait <= 0) {
      last.current = performance.now();
      setShown(value);
    } else {
      pending.current = setTimeout(() => {
        last.current = performance.now();
        setShown(value);
      }, wait);
    }
    return () => clearTimeout(pending.current);
  }, [value, shown, ms]);
  return shown;
}

const STATUS_LABEL = { ouvert: "Ouvert", achalandé: "Achalandé", pause: "En pause" } as const;

export function RestaurantPanel({ idx, drawable, style }: { idx: number; drawable?: boolean; style?: CSSProperties }) {
  const r = RESTAURANTS[idx];
  const liveRaw = useCarte((s) => s.restaurants[idx]);
  const live: RestaurantView = useThrottled(liveRaw);
  const [paused, setPaused] = useState(live.status === "pause");
  const [sending, setSending] = useState<"" | "…" | "✓">("");
  const [saved, setSaved] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // l'interrupteur suit le serveur tant que l'utilisateur ne l'a pas touché récemment
  useEffect(() => setPaused(live.status === "pause"), [live.status]);
  useEffect(() => panelHooks.onRestaurantCommit(idx), [live, idx]);
  useEffect(() => {
    const t = area.current;
    if (t && document.activeElement !== t && t.value !== live.note) t.value = live.note;
  }, [live.note]);
  const attrs = drawable ? { drawable: "" } : {};
  const size = PANEL_SIZE.restaurant;
  return (
    <section className={`mpanel st-${live.status}`} data-panel={`r${idx}`} aria-label={`${r.name} — ${STATUS_LABEL[live.status]}`} style={{ width: size.w, height: size.h, ...style }} {...attrs}>
      <header>
        <strong>{r.name}</strong>
        <span className="mpill">{STATUS_LABEL[live.status]}</span>
        <button type="button" className="mclose" aria-label={`Fermer ${r.name}`} onClick={() => toggleRestaurant(idx, false)}>
          ✕
        </button>
      </header>
      <dl>
        <dt>Commandes en attente</dt>
        <dd>{live.pending}</dd>
        <dt>Préparation moyenne</dt>
        <dd>{live.prepMin} min</dd>
        <dt>Livreurs envoyés</dt>
        <dd>{live.dispatched}</dd>
      </dl>
      <label className="mswitch">
        <input
          type="checkbox"
          role="switch"
          checked={paused}
          data-pause={r.id}
          onChange={(e) => {
            const v = e.currentTarget.checked;
            setPaused(v);
            setPausedAction(r.id, v).then(() => void refreshRestaurants());
          }}
        />
        Mettre en pause les commandes en ligne
      </label>
      <textarea
        ref={area}
        defaultValue={live.note}
        rows={2}
        placeholder="Note pour l'équipe…"
        aria-label={`Note pour l'équipe, ${r.name}`}
        data-note={r.id}
        onInput={(e) => {
          const v = e.currentTarget.value;
          setSaved("…");
          clearTimeout(timer.current);
          timer.current = setTimeout(() => saveRestaurantNoteAction(r.id, v).then(() => setSaved("✓")), 500);
        }}
      />
      <div className="mfoot">
        <button
          type="button"
          data-dispatch={r.id}
          onClick={async () => {
            setSending("…");
            await dispatchCourierAction(r.id);
            setSending("✓");
            void refreshRestaurants();
          }}
        >
          Envoyer un livreur {sending}
        </button>
        <span className="msaved" aria-live="polite">
          {saved}
        </span>
      </div>
    </section>
  );
}

export function CourierPanel({ idx, drawable, style }: { idx: number; drawable?: boolean; style?: CSSProperties }) {
  const c = COURIERS[idx];
  const [text, setText] = useState(() => snapshot(idx));
  const throttled = useThrottled(text);
  const assigned = useCarte((s) => s.assignments[c.id]);
  // les positions changent chaque seconde : le texte n'est relu que toutes les 2 s
  useEffect(() => {
    const t = setInterval(() => setText(snapshot(idx)), THROTTLE_MS);
    return () => clearInterval(t);
  }, [idx]);
  const dest = assigned ? RESTAURANTS.find((r) => r.id === assigned)!.name : throttled.target >= 0 ? RESTAURANTS[throttled.target].name : "—";
  const attrs = drawable ? { drawable: "" } : {};
  const size = PANEL_SIZE.courier;
  return (
    <section className="mpanel courier" data-panel={`c${idx}`} aria-label={`Livreur ${c.name}`} style={{ width: size.w, height: size.h, ...style }} {...attrs}>
      <header>
        <strong>🛵 {c.name}</strong>
        <button type="button" className="mclose" aria-label={`Fermer ${c.name}`} onClick={() => toggleCourier(idx, false)}>
          ✕
        </button>
      </header>
      <dl>
        <dt>Commande</dt>
        <dd>{throttled.order || "—"}</dd>
        <dt>Vers</dt>
        <dd className="mdest">{dest}</dd>
        <dt>Arrivée estimée</dt>
        <dd>{throttled.eta ? `${Math.max(1, Math.round(throttled.eta / 60))} min` : "—"}</dd>
      </dl>
      <button type="button" data-reassign={c.id} onClick={() => reassignCourierAction(c.id).then(() => void refreshRestaurants())}>
        Réassigner
      </button>
    </section>
  );
}

function snapshot(idx: number) {
  // l'ETA est arrondie à la minute : le HTML ne change que si la minute change
  return { order: couriers.order[idx], target: couriers.target[idx], eta: Math.round(couriers.eta[idx] / 60) * 60 };
}

/** Rafraîchit l'état serveur après une action (sans attendre le prochain polling). */
export let refreshRestaurants: () => Promise<void> = async () => {};
export function setRefresh(fn: () => Promise<void>) {
  refreshRestaurants = fn;
}

export const openState = () => carteStore.getState();
