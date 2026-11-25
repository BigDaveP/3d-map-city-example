"use client";
/**
 * Coupe souterraine du scénario (étape d'isolation) : la chaussée, la profondeur, la conduite, la
 * pression le long du tronçon (reçue du flux) et les deux vannes du plan d'isolation, qui sont de
 * vrais boutons « V-xx · à fermer ». Les fermer toutes les deux appelle `closeValvesAction`.
 *  - `drawable` : surface `cut:<tronçon>` de 560 × 230 px, plan vertical sous la rue dans la scène ;
 *    son contenu suit le sens de lecture de la surface (`cutView.reversed`) ;
 *  - sinon : illustration 2D dans la fiche de l'incident (mode classique), boutons sous le dessin.
 * Profondeur et vannes simulées ; échelle verticale exagérée, indiquée sur la coupe.
 */
import { useId } from "react";
import { useStore } from "zustand";
import { MATERIAL, num } from "../format";
import { segment, type NetIndex } from "../net";
import { turnValve } from "../scenarioController";
import { useAq } from "../useAq";
import { useThrottled } from "../../hic3d/useThrottled";
import { CUT_DEPTH, cutView, verticalExaggeration, type CutLayout } from "./cut";
import { SURFACE_SIZE, surfaceKey } from "./marks";

const { w: W, h: H } = SURFACE_SIZE.cut;
const yOfDepth = (m: number) => CUT_DEPTH.groundPx + m * CUT_DEPTH.pxPerM;
const PIPE_Y = yOfDepth(CUT_DEPTH.pipeAxisM);
/** courbe de pression : 0 bar en bas de la bande, 5 bar en haut */
const yOfBar = (p: number) => 124 - Math.min(5.2, Math.max(0, p)) * 17;

/** Pressions des points du profil (flux), en une chaîne recapturée au plus toutes les 2 s. */
function usePressures(net: NetIndex, cut: CutLayout): (number | null)[] {
  const raw = useAq((s) =>
    cut.points
      .map((p) => {
        const k = net.demoPos.get(p.seg);
        return k === undefined || !s.live.t ? "" : String(s.live.pressure[k]);
      })
      .join("|"),
  );
  return useThrottled(raw)
    .split("|")
    .map((v) => (v === "" ? null : Number(v)));
}

export function CutSection({ net, cut, drawable }: { net: NetIndex; cut: CutLayout; drawable?: boolean }) {
  const reversedScene = useStore(cutView, (s) => s.reversed);
  const reversed = drawable ? reversedScene : false;
  const turned = useAq((s) => s.scenario.valvesTurned);
  const closed = useAq((s) => s.scenario.valvesClosed);
  const error = useAq((s) => s.scenario.error);
  const pressures = usePressures(net, cut);
  const p = segment(net, cut.seg).properties;
  const X = (x: number) => (reversed ? 1 - x : x) * W;
  const [v0, v1] = [X(cut.valves[0].x), X(cut.valves[1].x)].sort((a, b) => a - b);
  const brk = X(cut.breakX);
  const pts = cut.points.map((q, i) => ({ x: X(q.x), p: pressures[i] })).filter((q): q is { x: number; p: number } => q.p !== null);
  pts.sort((a, b) => a.x - b.x);
  const curve = pts.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)} ${yOfBar(q.p).toFixed(1)}`).join(" ");
  const brkP = pressures[cut.points.findIndex((q) => q.seg === cut.seg)];
  const edge = (side: 0 | 1) => {
    const q = side === 0 ? pts[0] : pts[pts.length - 1];
    return q && (side === 0 ? q.x < v0 : q.x > v1) ? q : null;
  };
  const ex = Math.round(verticalExaggeration(cut, W));
  const pipe = `${p.id} · Ø ${p.d} mm · ${MATERIAL[p.m].toLowerCase()}${p.y ? ` ${p.y}` : ""} · ${num(p.l)} m`;
  // texte des vannes : fermée dès le clic, confirmée par le serveur une fois les deux fermées
  const valves = cut.valves.map((v) => ({ ...v, sx: X(v.x), shut: closed || turned.includes(v.node) }));
  const label = (v: (typeof valves)[number]) => `${v.label} · ${v.shut ? "fermée" : "à fermer"}`;
  const fs = drawable ? 1 : 1.7;
  const id = `aq-cut${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const scene = drawable ? { "data-panel": surfaceKey("cut", p.id), drawable: "", style: { width: W, height: H } } : {};

  return (
    <div
      className={drawable ? "aq-cut" : "aq-cut aq-cut-card"}
      role="group"
      aria-label={`Coupe sous la rue (simulation) : ${pipe}, vannes ${valves.map(label).join(", ")}`}
      {...scene}
    >
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-soil`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b89a74" />
            <stop offset="1" stopColor="#6f5539" />
          </linearGradient>
          <linearGradient id={`${id}-road`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5d6570" />
            <stop offset="1" stopColor="#3f454d" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#${id}-soil)`} />
        <rect width={W} height={CUT_DEPTH.groundPx - 6} fill={`url(#${id}-road)`} />
        <rect y={CUT_DEPTH.groundPx - 6} width={W} height={6} fill="#a48a68" />
        {/* tranchée au-dessus du bris */}
        <path d={`M${brk - 34} ${CUT_DEPTH.groundPx} L${brk + 34} ${CUT_DEPTH.groundPx} L${brk + 22} ${PIPE_Y - 16} L${brk - 22} ${PIPE_Y - 16} Z`} fill="rgba(40,30,20,0.28)" />
        <g stroke="rgba(255,255,255,0.2)">
          {[0.5, 1, 1.5, 2].map((m) => (
            <line key={m} x1="0" x2={W} y1={yOfDepth(m)} y2={yOfDepth(m)} />
          ))}
        </g>
        <g fontSize={10 * fs} fill="rgba(255,255,255,0.85)">
          {[0.5, 1, 1.5, 2].map((m) => (
            <text key={m} x={reversed ? W - 6 : 6} y={yOfDepth(m) - 3} textAnchor={reversed ? "end" : "start"}>
              {num(m, 1)} m
            </text>
          ))}
        </g>
        {/* conduite : eau, puis vide entre les vannes une fois fermées */}
        <rect x="0" y={PIPE_Y - 14} width={W} height="28" rx="14" fill="#3d4a5c" />
        <rect x="0" y={PIPE_Y - 11} width={W} height="22" rx="11" fill="#2f8fd6" />
        {closed && <rect x={v0} y={PIPE_Y - 11} width={v1 - v0} height="22" fill="#c9d0d8" />}
        <rect x={brk - 26} y={PIPE_Y - 11} width="52" height="22" fill="#d23b2b" />
        {!closed && (
          <g fill="#fff">
            <circle cx={brk} cy={PIPE_Y - 2} r="3" />
            <circle cx={brk - 10} cy={PIPE_Y - 24} r="2.4" />
            <circle cx={brk + 6} cy={PIPE_Y - 38} r="2" />
            <circle cx={brk - 3} cy={PIPE_Y - 54} r="1.6" />
          </g>
        )}
        {valves.map((v) => (
          <rect key={v.node} x={v.sx - 7} y={PIPE_Y - 26} width="14" height="52" rx="3" fill={v.shut ? "#142133" : "#0a5cc2"} stroke="#fff" strokeWidth="1.5" />
        ))}
        {/* pression le long du tronçon (simulée, reçue du flux) */}
        {curve && <path d={curve} fill="none" stroke="#fff" strokeWidth="2.5" strokeLinejoin="round" />}
        <g fontSize={12 * fs} fontWeight="600" fill="#fff" className="aq-cut-num">
          {edge(0) && (
            <text x={edge(0)!.x + 4} y={yOfBar(edge(0)!.p) - 7}>
              {num(edge(0)!.p, 1)} bar
            </text>
          )}
          {edge(1) && (
            <text x={edge(1)!.x - 4} y={yOfBar(edge(1)!.p) - 7} textAnchor="end">
              {num(edge(1)!.p, 1)} bar
            </text>
          )}
          {brkP !== null && brkP !== undefined && (
            <text x={brk} y={Math.min(yOfBar(brkP) + 18 * fs, PIPE_Y - 30)} textAnchor="middle" fontWeight="800">
              {brkP === 0 ? "0 bar · sans eau" : `${num(brkP, 1)} bar`}
            </text>
          )}
        </g>
        {drawable && (
          <g fontSize="11.5" fill="#fff">
            <text x="8" y={H - 6} fontWeight="600">
              {pipe}
            </text>
            <text x={W - 8} y={H - 6} textAnchor="end" opacity="0.85">
              simulé · profondeur ×{ex}
            </text>
          </g>
        )}
        {!drawable &&
          valves.map((v) => (
            <text key={v.node} x={Math.min(W - 40, Math.max(40, v.sx))} y={PIPE_Y + 50} fontSize={12 * fs} fontWeight="700" fill="#fff" textAnchor="middle">
              {v.label}
            </text>
          ))}
      </svg>
      {drawable ? (
        valves.map((v) => (
          <button
            key={v.node}
            type="button"
            className="aq-valve"
            aria-pressed={v.shut}
            disabled={closed}
            style={{ left: v.sx, top: PIPE_Y + 30 }}
            onClick={() => void turnValve(v.node)}
          >
            {label(v)}
          </button>
        ))
      ) : (
        <div className="aq-btns aq-valves">
          {valves.map((v) => (
            <button key={v.node} type="button" className="aq-btn aq-valve-card" aria-pressed={v.shut} disabled={closed} onClick={() => void turnValve(v.node)}>
              {label(v)}
            </button>
          ))}
        </div>
      )}
      {!drawable && <p className="aq-note">Profondeur (simulée) exagérée ×{ex} ; vannes simulées.</p>}
      {error && (
        <p className="aq-cut-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
