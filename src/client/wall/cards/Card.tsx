"use client";
/**
 * Carte d'indicateur : même composant pour le mode DOM et le mode HTML-in-Canvas.
 * Niveau 1 : version légère (nom, chiffre clé, icône). Niveau 2 : panneau complet.
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { assignAction, createAlertAction, saveNoteAction } from "@/app/actions";
import { WEATHER_ICON } from "@/lib/sim/generators";
import { cardId as makeCardId, KIND_LABEL, KINDS, STATUS_LABEL, type Kind } from "@/lib/sim/types";
import { SPARK_N } from "../../live";
import { statusOf, useData, type DataState, type DataStore } from "../../store";
import { CARD_CSS, SPARK_ZONE } from "./zones";

const eur = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const fr1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export interface CardProps {
  ds: DataStore;
  card: number;
  level: 1 | 2;
  /** Mode HTML-in-Canvas : attribut `drawable` et sparkline laissée à WebGL. */
  drawable?: boolean;
  style?: CSSProperties;
  /** panneau ouvert depuis le niveau intermédiaire : affiche un bouton de fermeture */
  onClose?: () => void;
}

function kindSlice(s: DataState, b: number, kind: Kind) {
  switch (kind) {
    case "sales":
      return s.sales[b];
    case "staff":
      return s.staff[b];
    case "reviews":
      return s.reviews[b];
    case "weather":
      return s.weather[b];
    case "alerts":
      return s.alerts[b];
  }
}

export const Card = memo(function Card({ ds, card, level, drawable, style, onClose }: CardProps) {
  const b = Math.floor(card / KINDS.length);
  const kind = KINDS[card % KINDS.length];
  const branch = useData(ds, (s) => s.branches[b]);
  const slice = useData(ds, (s) => kindSlice(s, b, kind));
  const status = useData(ds, (s) => statusOf(s, b, kind));
  const id = makeCardId(branch.id, kind);
  const size = CARD_CSS[level];
  const label = `${branch.name} — ${KIND_LABEL[kind]} — ${STATUS_LABEL[status]}`;
  const attrs = drawable ? { drawable: "" } : {};
  return (
    <article
      className={`card lvl${level} st${status} k-${kind}`}
      data-card={card}
      data-card-id={id}
      data-level={level}
      aria-label={level === 1 ? `${label} — cliquer pour ouvrir le panneau` : label}
      style={{ width: size.w, height: size.h, ...style }}
      {...attrs}
    >
      <header className="card-h">
        <span className="card-name">{branch.name}</span>
        <span className="card-kind">{KIND_LABEL[kind]}</span>
        <span className={`pill st${status}`}>{STATUS_LABEL[status]}</span>
        {onClose && (
          <button type="button" className="close" onClick={onClose} aria-label={`Fermer le panneau ${branch.name} ${KIND_LABEL[kind]}`}>
            ✕
          </button>
        )}
      </header>
      {level === 1 ? <MidBody kind={kind} slice={slice} /> : <FullBody kind={kind} slice={slice} ds={ds} id={id} status={status} />}
      {kind === "sales" && (
        <div className="spark-zone" style={zoneStyle(level)} aria-hidden>
          {!drawable && <Sparkline ds={ds} branch={b} level={level} version={(slice as DataState["sales"][number]).updatedAt} />}
        </div>
      )}
    </article>
  );
});

const zoneStyle = (level: 1 | 2): CSSProperties => {
  const z = SPARK_ZONE[level];
  return { left: z.x, top: z.y, width: z.w, height: z.h };
};

type Slice = ReturnType<typeof kindSlice>;

function MidBody({ kind, slice }: { kind: Kind; slice: Slice }) {
  switch (kind) {
    case "sales": {
      const v = slice as DataState["sales"][number];
      return (
        <div className="mid">
          <div className="big">{eur.format(v.revenue)} €</div>
          <div className="sub">
            {v.transactions} tx · rythme {Math.round(v.pace * 100)} %
          </div>
        </div>
      );
    }
    case "staff": {
      const v = slice as DataState["staff"][number];
      return (
        <div className="mid">
          <div className="big">
            {v.onDuty}/{v.scheduled} <small>en poste</small>
          </div>
          <div className="sub">
            {v.late} retard{v.late > 1 ? "s" : ""} · {v.vacancies} vacant{v.vacancies > 1 ? "s" : ""}
          </div>
        </div>
      );
    }
    case "reviews": {
      const v = slice as DataState["reviews"][number];
      return (
        <div className="mid">
          <div className="big">{fr1.format(v.rating)} ★</div>
          <div className="sub">{v.count} avis</div>
        </div>
      );
    }
    case "weather": {
      const v = slice as DataState["weather"][number];
      return (
        <div className="mid">
          <div className="big">
            <span className="wicon">{WEATHER_ICON[v.condition]}</span> {v.temp} °C
          </div>
          <div className="sub">{v.condition}</div>
        </div>
      );
    }
    case "alerts": {
      const v = slice as DataState["alerts"][number];
      return (
        <div className="mid">
          <div className="big">
            {v.length} <small>alerte{v.length > 1 ? "s" : ""}</small>
          </div>
          <div className="sub">{v[0]?.message ?? "Aucune alerte"}</div>
        </div>
      );
    }
  }
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <tr>
      <th scope="row">{k}</th>
      <td>{v}</td>
    </tr>
  );
}

function FullBody({ kind, slice, ds, id, status }: { kind: Kind; slice: Slice; ds: DataStore; id: string; status: number }) {
  let rows: React.ReactNode;
  let extra: React.ReactNode = null;
  switch (kind) {
    case "sales": {
      const v = slice as DataState["sales"][number];
      rows = (
        <>
          <Row k="CA du jour" v={`${eur.format(v.revenue)} €`} />
          <Row k="Transactions" v={v.transactions} />
          <Row k="Rythme" v={`${Math.round(v.pace * 100)} %`} />
        </>
      );
      break;
    }
    case "staff": {
      const v = slice as DataState["staff"][number];
      rows = (
        <>
          <Row k="En poste" v={`${v.onDuty} / ${v.scheduled}`} />
          <Row k="Retards" v={v.late} />
          <Row k="Postes vacants" v={v.vacancies} />
        </>
      );
      extra = (
        <div className="bar" role="img" aria-label={`Présence ${Math.round((v.onDuty / v.scheduled) * 100)} %`}>
          <span style={{ width: `${(v.onDuty / v.scheduled) * 100}%` }} />
        </div>
      );
      break;
    }
    case "reviews": {
      const v = slice as DataState["reviews"][number];
      rows = (
        <>
          <Row k="Note moyenne" v={`${fr1.format(v.rating)} / 5`} />
          <Row k="Nombre d'avis" v={v.count} />
          <Row k="Dernier avis" v={"★".repeat(v.last.stars) + "☆".repeat(5 - v.last.stars)} />
        </>
      );
      extra = (
        <blockquote className="review">
          « {v.last.text} » <cite>— {v.last.author}</cite>
        </blockquote>
      );
      break;
    }
    case "weather": {
      const v = slice as DataState["weather"][number];
      rows = (
        <>
          <Row k="Condition" v={v.condition} />
          <Row k="Température" v={`${v.temp} °C`} />
          <Row k="Vigilance" v={v.condition === "orage" ? "rouge" : v.condition === "neige" ? "orange" : "aucune"} />
        </>
      );
      extra = <div className="wbig">{WEATHER_ICON[v.condition]}</div>;
      break;
    }
    case "alerts": {
      const v = slice as DataState["alerts"][number];
      rows = (
        <>
          <Row k="Actives" v={v.length} />
          <Row k="Critiques" v={v.filter((a) => a.level === 2).length} />
          <Row k="Manuelles" v={v.filter((a) => a.source === "manuelle").length} />
        </>
      );
      extra = (
        <ul className="alist">
          {v.slice(0, 2).map((a) => (
            <li key={a.id}>
              {a.level === 2 ? "⛔" : "⚠️"} {a.message}
            </li>
          ))}
          {v.length === 0 && <li>Aucune alerte active</li>}
        </ul>
      );
      break;
    }
  }
  return (
    <>
      <table className="mini">
        <tbody>{rows}</tbody>
      </table>
      <div className="extra">{extra}</div>
      <CardControls ds={ds} id={id} status={status} />
    </>
  );
}

function CardControls({ ds, id, status }: { ds: DataStore; id: string; status: number }) {
  const note = useData(ds, (s) => s.notes[id] ?? "");
  const assigned = useData(ds, (s) => s.assign[id] ?? 0);
  const managers = useData(ds, (s) => s.managers);
  const [saving, setSaving] = useState<"" | "…" | "✓" | "✗">("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // la note est non contrôlée : la saisie reste fluide ; une valeur arrivée du serveur après le
  // montage (chargement initial des notes) est recopiée tant que le champ n'a pas le focus
  const initial = useRef(note);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = area.current;
    if (t && document.activeElement !== t && t.value !== note) t.value = note;
  }, [note]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const onInput = useCallback(
    (e: React.FormEvent<HTMLTextAreaElement>) => {
      const body = e.currentTarget.value;
      ds.setNote(id, body);
      setSaving("…");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveNoteAction(id, body).then(
          () => setSaving("✓"),
          () => setSaving("✗"),
        );
      }, 500);
    },
    [ds, id],
  );

  const onAssign = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const managerId = Number(e.currentTarget.value);
    ds.setAssign(id, managerId);
    assignAction(id, managerId).catch(() => setSaving("✗"));
  };

  const onAlert = async () => {
    const a = await createAlertAction(id, status === 2 ? 2 : 1, `Alerte créée depuis la carte ${id}`);
    const s = ds.store.getState();
    ds.setManualAlerts([a, ...s.manualAlerts], performance.now());
  };

  return (
    <>
      <div className="note">
        <textarea
          ref={area}
          defaultValue={initial.current}
          onInput={onInput}
          placeholder="Note d'équipe…"
          aria-label={`Note d'équipe ${id}`}
          data-note={id}
          rows={2}
          spellCheck={false}
        />
        <span className="saving" aria-live="polite">
          {saving}
        </span>
      </div>
      <div className="foot">
        <select value={assigned || ""} onChange={onAssign} aria-label={`Responsable ${id}`} data-assign={id}>
          <option value="">Responsable…</option>
          {managers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <button type="button" onClick={onAlert} data-alert={id}>
          Créer une alerte
        </button>
      </div>
    </>
  );
}

/** Sparkline SVG : uniquement en mode DOM. */
function Sparkline({ ds, branch, level }: { ds: DataStore; branch: number; level: 1 | 2; version: number }) {
  const z = SPARK_ZONE[level];
  const buf = new Float32Array(SPARK_N);
  const n = ds.live.sparkSeries(branch, buf);
  let max = 1;
  for (let i = 0; i < n; i++) max = Math.max(max, buf[i]);
  let d = "";
  for (let i = 0; i < n; i++) {
    const x = (i / (SPARK_N - 1)) * z.w;
    const y = z.h - 2 - (buf[i] / max) * (z.h - 4);
    d += `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return (
    <svg width={z.w} height={z.h} className="spark">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={level === 2 ? 1.5 : 1.2} />
    </svg>
  );
}
