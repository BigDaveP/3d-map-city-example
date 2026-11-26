/**
 * Icône de la condition du ciel (voir lib/territoire/weatherIcon.ts), au trait comme les autres
 * pictogrammes de l'interface : 1,5 px à toutes les tailles, couleur du texte. Sans état : rendu par
 * le serveur (accueil) comme par le client (panneau du déneigement).
 *
 * Tracés : Lucide (https://lucide.dev), licence ISC, © Lucide Contributors 2022 et, pour les parties
 * issues de Feather, © Cole Bemis 2013-2022 (MIT). Repris tels quels (sun, moon, cloud, cloudy,
 * cloud-sun, cloud-moon, cloud-rain, cloud-sun-rain, cloud-moon-rain, cloud-snow, cloud-hail,
 * cloud-lightning, cloud-fog, wind, circle-help) ou assemblés à partir d'eux (averses de neige,
 * pluie verglaçante). Avis complets (ISC de Lucide, MIT de Feather) : THIRD_PARTY_NOTICES.md.
 *
 * ISC License — Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * The MIT License (MIT) (moon, derived from Feather) — Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import type { WeatherCondition } from "@/lib/territoire/weatherIcon";

/** Nuage ouvert par le bas, au-dessus des précipitations (Lucide, cloud-rain et suivants). */
const CLOUD_OPEN = "M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242";
/** Soleil derrière un nuage bas, et le nuage bas (Lucide, cloud-sun-rain). */
const SUN_BEHIND = ["M12 2v2", "m4.93 4.93 1.41 1.41", "M20 12h2", "m19.07 4.93-1.41 1.41", "M15.947 12.65a4 4 0 0 0-5.925-4.128"];
const MOON_BEHIND = ["M10.188 8.5A6 6 0 0 1 16 4a1 1 0 0 0 6 6 6 6 0 0 1-3 5.197"];
const LOW_CLOUD_OPEN = "M3 20a5 5 0 1 1 8.9-4H13a3 3 0 0 1 2 5.24";

const DAY: Record<WeatherCondition, string[]> = {
  soleil: ["M12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8Z", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  lune: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  "peu-nuageux": [...SUN_BEHIND, "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z"],
  nuageux: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
  couvert: ["M17.5 21H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", "M22 10a3 3 0 0 0-3-3h-2.207a5.502 5.502 0 0 0-10.702.5"],
  pluie: [CLOUD_OPEN, "M16 14v6", "M8 14v6", "M12 16v6"],
  averses: [...SUN_BEHIND, LOW_CLOUD_OPEN, "M11 20v2", "M7 19v2"],
  neige: [CLOUD_OPEN, "M8 15h.01", "M8 19h.01", "M12 17h.01", "M12 21h.01", "M16 15h.01", "M16 19h.01"],
  "averses-neige": [...SUN_BEHIND, LOW_CLOUD_OPEN, "M11 21h.01", "M7 20h.01"],
  "pluie-verglacante": [CLOUD_OPEN, "M8 14v4", "M16 14v4", "M12 16v4", "M10.5 21h3"],
  grele: [CLOUD_OPEN, "M16 14v2", "M8 14v2", "M16 20h.01", "M8 20h.01", "M12 16v2", "M12 22h.01"],
  orage: ["M6 16.326A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.973", "m13 12-3 5h4l-3 5"],
  brouillard: [CLOUD_OPEN, "M16 17H7", "M17 21H9"],
  vent: ["M12.8 19.6A2 2 0 1 0 14 16H2", "M17.5 8a2.5 2.5 0 1 1 2 4H2", "M9.8 4.4A2 2 0 1 1 11 8H2"],
  inconnu: ["M12 2a10 10 0 1 0 0 20 10 10 0 1 0 0-20Z", "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3", "M12 17h.01"],
};

/** La nuit, la lune remplace le soleil derrière le nuage. */
const NIGHT: Partial<Record<WeatherCondition, string[]>> = {
  "peu-nuageux": [...MOON_BEHIND, "M13 16a3 3 0 1 1 0 6H7a5 5 0 1 1 4.9-6Z"],
  averses: [...MOON_BEHIND, LOW_CLOUD_OPEN, "M11 20v2", "M7 19v2"],
  "averses-neige": [...MOON_BEHIND, LOW_CLOUD_OPEN, "M11 21h.01", "M7 20h.01"],
};

interface Props {
  condition: WeatherCondition;
  /** 48 (conditions actuelles) ou 16 (prévision horaire) */
  size?: number;
  night?: boolean;
  /** nom accessible (condition d'ECCC) ; sans lui, l'icône est décorative */
  label?: string;
}

export function WeatherIcon({ condition, size = 16, night = false, label }: Props) {
  const paths = (night && NIGHT[condition]) || DAY[condition];
  return (
    <svg
      className="tr-wx-i"
      data-condition={condition}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}
