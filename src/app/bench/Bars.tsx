/**
 * Barres groupées en SVG (rendu serveur) : x = nombre de cartes, une barre par configuration.
 * Infobulle au survol via <title> (natif, accessible au clavier par lecteur d'écran) et
 * surbrillance CSS ; les valeurs exactes sont dans le tableau sous les graphiques.
 */
export interface Series {
  key: string;
  label: string;
  color: string; // variable CSS
}

export function Bars({
  title,
  unit,
  groups,
  groupLabel,
  series,
  value,
  note,
  digits = 1,
}: {
  title: string;
  unit: string;
  groups: (string | number)[];
  groupLabel: (g: string | number) => string;
  series: Series[];
  value: (g: string | number, s: string) => number | undefined;
  note?: string;
  digits?: number;
}) {
  const W = 460;
  const H = 220;
  const m = { l: 44, r: 8, t: 10, b: 28 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const vals = groups.flatMap((g) => series.map((s) => value(g, s.key) ?? 0));
  const rawMax = Math.max(1e-9, ...vals);
  const step = niceStep(rawMax / 4);
  const max = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const gw = iw / groups.length;
  const gap = 2;
  const bw = Math.min(34, (gw * 0.7 - gap * (series.length - 1)) / series.length);
  const y = (v: number) => m.t + ih - (v / max) * ih;
  const fmt = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: digits });
  return (
    <figure className="chart">
      <figcaption>
        <strong>{title}</strong> <span className="unit">({unit})</span>
        {note && <span className="cnote"> — {note}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} en ${unit}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={m.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
              {fmt(t)}
            </text>
          </g>
        ))}
        {groups.map((g, gi) => {
          const x0 = m.l + gi * gw + (gw - (bw * series.length + gap * (series.length - 1))) / 2;
          return (
            <g key={String(g)}>
              {series.map((s, si) => {
                const v = value(g, s.key);
                if (v === undefined) return null;
                const x = x0 + si * (bw + gap);
                const top = y(v);
                const h = Math.max(0, m.t + ih - top);
                const r = Math.min(4, h, bw / 2);
                // barre arrondie en haut (4 px), ancrée à la ligne de base
                const d = `M${x},${m.t + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${m.t + ih} Z`;
                return (
                  <g key={s.key} className="bar">
                    <rect x={x - 1} y={m.t} width={bw + 2} height={ih} className="hit" />
                    <path d={d} style={{ fill: `var(${s.color})` }} />
                    <title>{`${s.label} · ${groupLabel(g)} : ${fmt(v)} ${unit}`}</title>
                  </g>
                );
              })}
              <text x={m.l + gi * gw + gw / 2} y={H - 8} className="tick" textAnchor="middle">
                {groupLabel(g)}
              </text>
            </g>
          );
        })}
        <line x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} className="axis" />
      </svg>
    </figure>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="legend" aria-label="Légende">
      {series.map((s) => (
        <li key={s.key}>
          <span className="sw" style={{ background: `var(${s.color})` }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}
