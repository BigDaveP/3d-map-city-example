"use client";
/** Fiche ancrée à droite, affichée seulement quand un élément est sélectionné. */
import { useEffect, useState, type ReactNode } from "react";
import { publishNoticeAction } from "@/app/aqueduc-actions";
import { CITY } from "@/lib/aqueduc/city";
import { SCENARIO_STEPS } from "@/lib/aqueduc/scenario";
import { demand, FLUSHING_2026, localHour, nominalFlowLs, THRESHOLDS } from "@/lib/aqueduc/sim";
import { MATERIAL, num, PIPE_CLASS, sectorStatus, SENSOR_KIND, sensorValue, STATUS_LABEL } from "../format";
import { segment, type NetIndex } from "../net";
import { addNotice, select, type Notice } from "../store";
import { useAq } from "../useAq";

const TONE = ["good", "warn", "bad"] as const;
const DAY_FMT = new Intl.DateTimeFormat("fr-CA", { day: "numeric", month: "long", timeZone: "UTC" });

function KV({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="aq-kv">
      {rows.map(([k, v, tone]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className={tone ? `aq-${tone}` : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function SegmentCard({ net, id, incident }: { net: NetIndex; id: string; incident: boolean }) {
  const idx = net.segById.get(id)!;
  const p = segment(net, idx).properties;
  const pos = net.demoPos.get(idx);
  const pressure = useAq((s) => (pos === undefined ? undefined : s.live.pressure[pos]));
  const t = useAq((s) => s.live.t);
  const flow = pressure === 0 ? 0 : nominalFlowLs(p.d, demand(localHour(t || Date.now())));
  return (
    <>
      <header className="aq-insp-h">
        {incident && <span className="aq-badge">BRIS PROBABLE</span>}
        <span className="aq-insp-id aq-num">{p.id}</span>
        <span className="aq-insp-sub">
          {PIPE_CLASS[p.c]} · {net.sectorById.get(p.s)?.name}
        </span>
      </header>
      <KV
        rows={[
          ["Diamètre", <span className="aq-num" key="d">{p.d} mm</span>],
          ["Matériau", MATERIAL[p.m]],
          ["Installation", <span className="aq-num" key="y">{p.y ?? "inconnue"}</span>],
          ["Longueur", <span className="aq-num" key="l">{num(p.l)} m</span>],
          [
            "Pression",
            pressure === undefined ? "hors zone suivie" : <span className="aq-num" key="p">{num(pressure, 1)} bar</span>,
            pressure === undefined ? undefined : pressure < THRESHOLDS.pressureMin ? "bad" : pressure < 2.5 ? "warn" : undefined,
          ],
          ["Débit estimé", <span className="aq-num" key="q">{num(flow, flow < 10 ? 1 : 0)} L/s</span>],
          [
            "Bris antérieurs",
            <span key="b">
              <span className="aq-num">{p.b}</span> depuis 2009
            </span>,
          ],
        ]}
      />
      <p className="aq-note">Tracé, diamètre, matériau, année et longueur : Ville de Trois-Rivières. Pression, débit et bris : simulés.</p>
    </>
  );
}

function SensorCard({ net, id }: { net: NetIndex; id: string }) {
  const s = net.sensorById.get(id)!;
  const r = useAq((st) => st.live.readings[s.idx]);
  const k = SENSOR_KIND[s.kind];
  return (
    <>
      <header className="aq-insp-h">
        <span className="aq-insp-id aq-num">{s.id}</span>
        <span className="aq-insp-sub">
          {k.name} · simulation · {net.sectorById.get(s.sector)?.name}
        </span>
      </header>
      <KV
        rows={[
          [k.measure, r ? <span className="aq-num" key="v">{sensorValue(s.kind, r[0])}</span> : "…", r ? TONE[r[1]] : undefined],
          ["Seuil", k.threshold],
          ["État", r ? STATUS_LABEL[r[1]] : "…", r ? TONE[r[1]] : undefined],
        ]}
      />
      <p className="aq-note">La courbe de la journée est dans la frise, en bas.</p>
    </>
  );
}

function NoticeButtons({ sectorId }: { sectorId: string }) {
  const all = useAq((s) => s.notices);
  const notices = all.filter((n) => n.sectorId === sectorId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const publish = async (kind: Notice["kind"]) => {
    setBusy(true);
    setError("");
    try {
      const r = await publishNoticeAction(sectorId, kind);
      addNotice(r.notice);
    } catch {
      setError("L'avis n'a pas pu être publié. Réessayez.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="aq-notices">
      <h3 className="aq-h3">Avis aux citoyens</h3>
      <div className="aq-btns">
        <button type="button" className="aq-btn" disabled={busy} onClick={() => publish("ebullition")}>
          Avis d&apos;ébullition
        </button>
        <button type="button" className="aq-btn" disabled={busy} onClick={() => publish("interruption")}>
          Avis d&apos;interruption
        </button>
      </div>
      {error && (
        <p className="aq-bad" role="alert">
          {error}
        </p>
      )}
      <ul aria-live="polite">
        {notices.map((n) => (
          <li key={n.kind}>{n.text}</li>
        ))}
      </ul>
    </div>
  );
}

function SectorCard({ net, id }: { net: NetIndex; id: string }) {
  const sec = net.sectorById.get(id)!;
  const stat = useAq((s) => s.live.sectors.find((x) => x.id === id));
  const alerts = useAq((s) => s.live.readings.filter((r, i) => r[1] === 2 && net.data.sensors[i]?.sector === id).length);
  const flush = FLUSHING_2026.find((f) => f.sectorId === id);
  const st = stat ? sectorStatus(stat, alerts) : null;
  return (
    <>
      <header className="aq-insp-h">
        <span className="aq-insp-id">{sec.name}</span>
        <span className="aq-insp-sub">Secteur de distribution simulé</span>
      </header>
      <KV
        rows={[
          ["État", st?.label ?? "…", st ? TONE[st.level] : undefined],
          [
            "Adresses desservies",
            <span key="a">
              <span className="aq-num">{num(stat?.served ?? sec.addresses)}</span> sur <span className="aq-num">{num(sec.addresses)}</span>
            </span>,
          ],
          ["Débit entrant", <span className="aq-num" key="f">{stat ? `${num(stat.flowLs)} L/s` : "…"}</span>],
          [
            "Débit de nuit",
            stat ? (
              <span key="n">
                <span className="aq-num">
                  {stat.nightRatio >= 1 ? "+" : "−"}
                  {num(Math.abs(stat.nightRatio - 1) * 100)} %
                </span>{" "}
                de l&apos;attendu
              </span>
            ) : (
              "…"
            ),
            stat && st?.level === 1 ? "warn" : undefined,
          ],
          ["Rinçage 2026", flush ? `${DAY_FMT.format(new Date(flush.start))} au ${DAY_FMT.format(new Date(flush.end))}` : "—"],
        ]}
      />
      <p className="aq-note">Adresses estimées à une par 12 m de conduite ; débits et débit de nuit simulés.</p>
      <NoticeButtons sectorId={id} />
    </>
  );
}

function IncidentCard({ net, id }: { net: NetIndex; id: string }) {
  const step = useAq((s) => s.scenario.step);
  const k = SCENARIO_STEPS.findIndex((x) => x.id === step);
  const idx = net.segById.get(id);
  return (
    <>
      <SegmentCard net={net} id={id} incident />
      <h3 className="aq-h3">Intervention</h3>
      <ol className="aq-steps">
        {SCENARIO_STEPS.map((x, i) => (
          <li key={x.id} data-state={i < k ? "done" : i === k ? "now" : undefined}>
            {x.title}
          </li>
        ))}
      </ol>
      {idx !== undefined && <NoticeButtons sectorId={segment(net, idx).properties.s} />}
    </>
  );
}

export function Inspector({ net }: { net: NetIndex }) {
  const sel = useAq((s) => s.selection);
  const incident = useAq((s) => s.incident !== null);
  useEffect(() => {
    if (!sel) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) select(null);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [sel]);
  if (!sel) return null;
  const known =
    sel.kind === "sensor" ? net.sensorById.has(sel.id) : sel.kind === "sector" ? net.sectorById.has(sel.id) : net.segById.has(sel.id);
  if (!known) return null;
  // l'incident est toujours sur le tronçon du scénario
  const isIncident = incident && sel.id === CITY.breakSegment;
  return (
    <aside className="aq-inspector aq-panel" aria-label="Fiche de l'élément sélectionné" data-testid="inspector">
      <button type="button" className="aq-close" aria-label="Fermer la fiche" onClick={() => select(null)}>
        ×
      </button>
      {sel.kind === "segment" && <SegmentCard net={net} id={sel.id} incident={isIncident} />}
      {sel.kind === "sensor" && <SensorCard net={net} id={sel.id} />}
      {sel.kind === "sector" && <SectorCard net={net} id={sel.id} />}
      {sel.kind === "incident" && <IncidentCard net={net} id={sel.id} />}
    </aside>
  );
}
