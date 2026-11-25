# Gestion du territoire 3D — Lot 1 : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformer la démo du réseau d'eau en outil de gestion du territoire : accueil, scène 3D persistante `/carte/[env]`, horloge commune et journée scénarisée, alertes, vraie météo d'Environnement Canada, « À propos », environnements **Aqueduc** (migré) et **Déneigement** (nouveau).

**Architecture:** La logique de la ville (journée, actions datées, déneigement, alertes, météo) est faite de fonctions pures dans `src/lib/territoire/`, testées sous Node. Le client garde un store Zustand commun (`src/client/territoire/store.ts`) avec l'horloge, le mode et les actions du visiteur. La carte MapLibre vit dans la mise en page de `/carte` et survit à la navigation entre environnements. Chaque environnement est un module qui monte ses couches, sa scène (HTML-in-Canvas ou classique) et son panneau. Le serveur reste sans état : le flux SSE de l'aqueduc reçoit l'incident calculé par le client, et la météo est mise en cache.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zustand 5, MapLibre GL 6.19, WebGL2, hôte HTML-in-Canvas (`src/client/hic3d/`), `node:test` + tsx, Playwright (smoke), API OGC GéoMet du SMC.

**Spec:** `docs/superpowers/specs/2026-11-25-territoire-design.md`. Lire aussi `RULES.md` et `AGENTS.md`.

## Global Constraints

- Lire `node_modules/next/dist/docs/` avant tout code Next (layouts, routes dynamiques, route handlers, `fetch` et cache, `generateStaticParams`, navigation).
- Interface et documentation en français. Toute donnée simulée porte « Simulation » ou « simulé ».
- Démo non officielle : aucun logo, gabarit, nom de marque ni texte copié d'une ville.
- Attribution visible partout où apparaissent les données correspondantes :
  - conduites : `CITY.attribution` (« Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 ») ;
  - zones de stationnement de nuit : « Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 » ;
  - météo : « Météo : Environnement et Changement climatique Canada (Licence du gouvernement ouvert – Canada) » ;
  - fond de carte : OpenFreeMap / OpenMapTiles / OpenStreetMap.
- Règles HTML-in-Canvas de `RULES.md` inchangées. Mode classique pour tout visiteur sans l'API ; bandeau et vidéo du visiteur sans l'API conservés.
- Budget d'interface d'une vue 3D :
  - barre d'application ;
  - sélecteur d'environnement ;
  - panneau (couches + opérations) ;
  - frise 24 h commune ;
  - fiche à la sélection ;
  - récit pendant le scénario du bris.
- Indicateurs de performance hors de la barre ; `/bench` reste accessible depuis « À propos ».
- État propre à chaque visiteur, sans base de données. Serveur sans état, sauf le cache météo.
- Fuseau `America/Toronto` pour toutes les heures de la journée.
- Commits atomiques en français, avec ces trois lignes finales après une ligne vide :
  ```
  Co-authored-by: David Pigeon <90649552+BigDaveP@users.noreply.github.com>
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01BmMCyQF7h5bjj5VhdPN1vs
  ```
- Branche `claude/territoire` (basée sur `claude/aqueduc-seul`). Le contrôleur pousse.
- Environnement sans GPU (SwiftShader) : toute mesure le dit.
- Réseau : la sortie HTTPS passe par un proxy (CA `/root/.ccr/ca-bundle.crt`, `NODE_EXTRA_CA_CERTS` si besoin). Ne jamais désactiver TLS ni retirer `HTTPS_PROXY`.

## Review Focus

1. **Visiteur arrivé entre 0 h et 6 h :** l'interdiction de la nuit est en vigueur, décidée « par la direction (simulé) » la veille ; feux allumés ; aucune action du visiteur requise.
2. **API météo indisponible, lente ou au format inattendu :** l'accueil et le déneigement affichent « Météo indisponible » et tombent sur la neige simulée ; aucune page ne plante ni n'attend plus de 5 s.
3. **Navigation entre environnements :** la carte n'est jamais recréée (même instance MapLibre, même contexte WebGL), et la scène HTML-in-Canvas de l'environnement quitté est démontée sans fuite (surfaces, couches, abonnements).
4. **Visiteur qui recule l'horloge** avant une de ses actions : l'action disparaît de l'affichage puis réapparaît en avançant ; aucune alerte « décider » ne revient pour une décision déjà prise à l'heure affichée.
5. **Décision après la limite de 15 h :** refusée avec un message clair ; les feux ne changent pas.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `src/lib/territoire/day.ts` | Journée locale, heures scénarisées, actions datées du visiteur |
| `src/lib/territoire/envs.ts` | Identifiants et métadonnées des environnements (sans React) |
| `src/lib/territoire/neige.ts` | Flotte, zones, état du déneigement à l'heure t (interdiction, feux, ressources, avancement) |
| `src/lib/territoire/alerts.ts` | Type `Alert`, alertes Aqueduc et Déneigement, résumé par gravité |
| `src/lib/territoire/meteo.ts` | Lecture de la réponse GéoMet → `Forecast`, neige prévue pour la nuit |
| `src/lib/aqueduc/scenario.ts` | (modifié) Récit relatif au jour, bris à 14 h, incident par défaut |
| `src/server/territoire/meteo.ts` | Appel GéoMet, cache, repli |
| `src/server/territoire/deneigement.ts` | Lecture des zones et des feux versionnés |
| `src/app/api/territoire/meteo/route.ts` | Météo pour le client |
| `src/app/api/territoire/deneigement/route.ts` | Zones, feux, flotte (statique) |
| `scripts/territoire-data.ts` | Téléchargement des zones, génération des feux simulés |
| `data/territoire/{stationnement-nuit.json,feux.json,SOURCE.md}` | Données versionnées |
| `src/client/territoire/store.ts` | Horloge, mode, API, repli, actions, environnement actif |
| `src/client/territoire/theme.css` | Jetons de couleur, typographie, gravités, états |
| `src/client/territoire/shell/{AppBar,EnvSwitcher,AlertBell,Timeline}.tsx` | Interface commune |
| `src/client/territoire/scene/TerritoireScene.tsx` | Carte persistante, montage du module actif |
| `src/client/territoire/modules/types.ts` | Interface `EnvModule` |
| `src/client/territoire/modules/aqueduc.tsx` | Aqueduc branché sur l'interface (réutilise `src/client/aqueduc/*`) |
| `src/client/territoire/modules/deneigement/*` | Couches, scène, panneau, fiche du déneigement |
| `src/app/page.tsx` | Accueil (remplace la carte de l'aqueduc) |
| `src/app/carte/layout.tsx`, `src/app/carte/[env]/page.tsx` | Scène persistante et routes d'environnement |
| `src/app/a-propos/page.tsx` | « À propos » |

---

### Task 1: Journée locale, actions datées, bris à 14 h

**Files:**
- Create: `src/lib/territoire/day.ts`, `src/lib/territoire/envs.ts` (see Task 4's Interfaces for its content; created here because `nextEvents` uses `EnvId`), `tests/territoire-day.test.ts`
- Modify: `src/lib/aqueduc/scenario.ts`, `tests/aqueduc-scenario.test.ts`, every caller of `SCENARIO_STEPS` / `SCENARIO_DAY` (`grep -rn "SCENARIO_" src tests bench scripts`)

**Interfaces:**
- Produces:
  - `TZ = "America/Toronto"`.
  - `dayStartOf(t: number): number`: local midnight. Handles DST, so a day lasts 23 h or 25 h.
  - `atHour(day: number, hhmm: string): number`: `day` + that local time, DST-safe.
  - `DAY_TIMES`, with exactly these values:
    `{ banEnd: "06:00", collecteStart: "07:00", forecastAt: "07:30", defaultDecisionAt: "10:00", decisionCritical: "12:00", breakAt: "14:00", decisionDeadline: "15:00", snowStart: "19:00", banStart: "23:00" }`
  - `type EnvAction =`
    - `{ at: number; kind: "ban"; zones: ZoneId[] }`
    - `| { at: number; kind: "assign"; resource: string; zone: ZoneId | null }`
    - `| { at: number; kind: "isolate" }`

    `ZoneId` is declared here as `"A" | "B" | "C"` and re-exported by `neige.ts`.
  - `actionsUpTo(actions: readonly EnvAction[], t: number): EnvAction[]`: only actions with `dayStartOf(a.at) === dayStartOf(t)` and `a.at <= t`. This rule handles rewinding and the reset at midnight.
  - `nextEvents(t: number, n: number): { at: number; label: string; env: EnvId }[]`: upcoming scripted events, with French labels from spec 5.2.
- In `scenario.ts`:
  - steps relative to the day: `scenarioSteps(day: number)`, keeping the current offsets moved 7 h 03 later, so detection is at 14:01, isolation 14:23, intervention 15:08, restoration 18:43, report 20:48;
  - `breakAt(day) = atHour(day, "14:00")`;
  - `stepAtTime(t)` uses the day of `t`;
  - new `dayIncident(t: number, isolatedAt: number | null, valves: readonly number[]): ScenarioIncidentParams | null`:
    - returns null before 14:00;
    - valves are closed from `isolatedAt` (the visitor) or from the intervention step (the default), whichever comes first;
    - `restoredAt` is the restoration step.
  - `SCENARIO_DAY` stays (2026-11-24, local midnight) as the reference day for tests, the bench and the proofs.

- [ ] **Step 1: Write the failing tests** in `tests/territoire-day.test.ts`:
  - `dayStartOf(Date.UTC(2026,10,24,7,30))` returns `Date.UTC(2026,10,24,5,0)` (02:30 local → local midnight, UTC−5).
  - The day of `Date.UTC(2026,2,8,12)` (DST change) lasts 23 h: `dayStartOf(next) - dayStartOf(t) === 23*3600e3`.
  - `atHour(SCENARIO_DAY, "14:00") - SCENARIO_DAY === 14*3600e3`.
  - `actionsUpTo` drops an action from the previous day and an action later than `t`.
  - `nextEvents(atHour(d,"08:00"), 2)` gives `["Décision par défaut de l'interdiction (10 h)", "Bris de conduite au centre-ville (14 h)"]`. The labels are free text, but the order is fixed.

  In `tests/aqueduc-scenario.test.ts`:
  - `dayIncident(atHour(d,"13:59"), null, v) === null`.
  - At 14:30 with no isolation: `closedValves` is empty.
  - At 15:10: `closedValves` deep-equals `v`.
  - With `isolatedAt = atHour(d,"14:25")`, at 14:26: closed.
  - `stepAtTime(atHour(d,"14:24"))` is `"isolation"`.
- [ ] **Step 2: Run** `npm test` → the new tests fail.
- [ ] **Step 3: Implement `day.ts` and change `scenario.ts`.** Use `Intl.DateTimeFormat` with `TZ` for local midnight, as `dayStart` in `src/client/aqueduc/format.ts` already does. Make `format.ts` reuse `dayStartOf`.
- [ ] **Step 4: Update the callers** (controller, Story, Timeline, proofs, bench, tests) to `scenarioSteps(dayStartOf(t))`. Run `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** « Ancre la journée sur l'heure locale et place le bris à 14 h ».

### Task 2: Vraie météo d'Environnement Canada

**Files:**
- Create: `src/lib/territoire/meteo.ts`, `src/server/territoire/meteo.ts`, `src/app/api/territoire/meteo/route.ts`, `tests/territoire-meteo.test.ts`
- Fixtures (already committed): `tests/fixtures/eccc-citypage-qc-130.json` (Trois-Rivières, sunny, with a « Bulletin météorologique spécial » warning) and `tests/fixtures/eccc-citypage-snow.json` (a city with a forecast of 1 cm of snow)

**Interfaces:**
- Produces, in `src/lib/territoire/meteo.ts` (pure):
  ```ts
  export interface Forecast {
    source: "eccc";
    issuedAt: string;            // lastUpdated
    current: { tempC: number | null; condition: string };
    periods: { name: string; summary: string; snowCm: number | null; rainMm: number | null }[];
    hourly: { t: number; tempC: number | null; condition: string; pop: number | null }[];
    warnings: { title: string; type: string; expires: string }[];
  }
  export function parseCityPage(feature: unknown): Forecast | null   // null if the format is unexpected
  export function snowTonightCm(f: Forecast): number                  // sum of snowCm over the first 2 periods
  export const SNOW_THRESHOLD_CM = 5;
  export function snowWarning(f: Forecast): string | null              // a warning whose title contains « NEIGE » or « HIVER »
  ```
  Read the French values (`.fr`) from `properties.currentConditions`, `forecastGroup.forecasts[]` (`period.textForecastName`, `textSummary`, `precipitation.accumulation.{amount.value, amount.units, name}`), `hourlyForecastGroup.hourlyForecasts[]` (`timestamp`, `temperature.value`, `condition`, `lop.value`) and `warnings[]` (`description`, `type`, `expiryTime`).
- Produces, in `src/server/territoire/meteo.ts`:
  - `METEO_URL = "https://api.weather.gc.ca/collections/citypageweather-realtime/items/qc-130?f=json&lang=fr"`;
  - `getForecast(fetchImpl = fetch): Promise<Forecast | null>`: 5 s timeout via `AbortSignal.timeout(5000)`, 30 min cache (use the Next 16 data-cache mechanism from the docs, or a module memo `{at, value}`), `null` on any error.
  - Route `GET /api/territoire/meteo`: returns `{ forecast: Forecast | null, attribution }` with `cache-control: public, max-age=300`.

- [ ] **Step 1: Write the failing tests:**
  - `parseCityPage(qc130)` gives `current.condition` non-empty, `periods.length >= 2`, `hourly.length >= 12` and `warnings[0].title === "BULLETIN MÉTÉOROLOGIQUE SPÉCIAL"`.
  - `snowTonightCm(parseCityPage(qc130)!) === 0`.
  - `snowTonightCm(parseCityPage(snow)!) === 1`.
  - `parseCityPage({})` is `null`, and so is `parseCityPage(null)`.
  - `getForecast` with a `fetchImpl` that rejects resolves to `null`; with one that returns the fixture, it resolves to a `Forecast`; with one that never resolves, it resolves to `null` within 6 s.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** both modules and the route.
- [ ] **Step 4: Run** `npm test` → PASS. Also hit the real API once with a `tsx` one-liner that calls `getForecast()` and prints `current`. Note the result in the report; don't add a test that depends on the network.
- [ ] **Step 5: Commit** « Ajoute la météo d'Environnement Canada ».

### Task 3: Données du déneigement (zones réelles, feux simulés)

**Files:**
- Create: `scripts/territoire-data.ts` (`npm run territoire:data`), `data/territoire/stationnement-nuit.json`, `data/territoire/feux.json`, `data/territoire/SOURCE.md`, `src/server/territoire/deneigement.ts`, `src/app/api/territoire/deneigement/route.ts`, `tests/territoire-data.test.ts`
- Source: `https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97/resource/2fcc9586-1ac7-4501-a310-ad2e7c2bf5c4/download/stationnement-nuit-v3r.json` (3 polygons, `V_DetailZone` = « Zone A/B/C »)

**Interfaces:**
- `stationnement-nuit.json`: `{ zones: { id: ZoneId; name: string; polygon: [number, number][][] }[], extractedAt: string }`, with coordinates rounded to 5 decimals.
- `feux.json`: `{ lights: { id: string; zone: ZoneId; at: [number, number] }[] }`. IDs are `F-A-001` and so on.
  - Generation: take the nodes of the `amenee`/`maitresse` segments of the aqueduct network (`data/aqueduc/trois-rivieres.json`, decoded with `decodeNetwork`) that fall inside each zone. Main streets follow the mains.
  - Keep a node only when it is more than 250 m from the lights already kept, so the result is deterministic.
  - Require 20 to 200 lights per zone. If a zone has fewer, also use `distribution` nodes spaced 400 m apart.
- `getDeneigementData(): { zones; lights; fleet: typeof FLEET }`, read once and memoized.
- `GET /api/territoire/deneigement` serves it statically (`force-static`).
- `SOURCE.md`: provenance, CC-BY 4.0, extraction date, and the sentence « Feux d'interdiction : simulation inspirée du système de la Ville de Québec ; Trois-Rivières n'en a pas à notre connaissance ».

- [ ] **Step 1: Write the failing tests** in `tests/territoire-data.test.ts`, reading the versioned files:
  - 3 zones with ids `A`, `B` and `C`;
  - every light is inside its zone (point-in-polygon);
  - each zone has between 20 and 200 lights;
  - lights within a zone are at least 250 m apart, except the `distribution` complement, which is at least 400 m apart.
- [ ] **Step 2: Write and run the script** (network via the proxy). Write the files, then run the tests → PASS.
- [ ] **Step 3: Add the route and its loader.** Add a test that `getDeneigementData().lights.length` equals the size of `feux.json`.
- [ ] **Step 4: Commit** « Ajoute les zones de stationnement de nuit et les feux simulés ».

### Task 4: Modèle du déneigement et alertes

**Files:**
- Create: `src/lib/territoire/neige.ts`, `src/lib/territoire/alerts.ts`, `tests/territoire-neige.test.ts`, `tests/territoire-alerts.test.ts`

**Interfaces:**
- `envs.ts` (created in Task 1):
  - `type EnvId = "aqueduc" | "deneigement" | "collecte" | "zonage" | "evaluation"`;
  - `ENVS: Record<EnvId, { title: string; icon: string; lot: 1 | 2; blurb: string }>`. Titles: « Aqueduc », « Déneigement », « Collecte », « Zonage », « Évaluation foncière ».
- `neige.ts`:
  - `type ResourceKind = "chenillette" | "niveleuse" | "souffleuse" | "camion"`.
  - `FLEET`: 24 resources (`CH-01..08`, `NI-01..06`, `SO-01..04`, `CA-01..06`), each with a `depot` among 2 simulated depots.
  - `type SnowSource = { kind: "eccc"; cm: number; label: string } | { kind: "simulation"; cm: 12 }`.
  - `snowSource(f: Forecast | null): SnowSource`: `eccc` if `snowTonightCm(f) >= SNOW_THRESHOLD_CM` or `snowWarning(f)`; otherwise `simulation`.
  - `interface ZonePlan { zone: ZoneId; ban: "aucune" | "programmee" | "en-vigueur"; decidedBy: "visiteur" | "direction" | null; decidedAt: number | null; resources: string[]; progress: number; lights: "eteint" | "programme" | "allume" }`.
  - `snowPlan(t: number, actions: readonly EnvAction[], source: SnowSource): ZonePlan[]`. Rules:
    1. Between 00:00 and 06:00, the plan is the default plan from the day before (all three zones, `direction`, default resources), `en-vigueur`, with `allume` lights. Visitor actions don't count (they reset at midnight).
    2. From 06:00 to 07:30, `aucune` / `eteint`.
    3. From 07:30, decisions run on the visitor's `ban` actions up to `t`, through `actionsUpTo`:
       - the last one made at or before 15:00 wins;
       - a `ban` after 15:00 is ignored by the model; the UI refuses it beforehand.
       - With no visitor `ban` before 10:00, the direction decides at 10:00: all zones, default assignment.
       - A later visitor `ban` replaces that default.
    4. The ban is `programmee` (lights `programme`) from the decision until 23:00, then `en-vigueur` (lights `allume`) until 06:00.
    5. Resources: default round-robin by zone; `assign` actions override per resource.
    6. Progress is 0 before 23:00, then `min(1, elapsed / (6.5 h × 8 / max(1, n)))`, where `n` is the number of resources assigned to the zone.
  - `banDeadlinePassed(t: number): boolean`.
- `alerts.ts`:
  ```ts
  export type Severity = "critique" | "attention" | "info";
  export interface Alert { id: string; env: EnvId; severity: Severity; title: string; detail: string; at: number; focus?: { kind: string; id: string } }
  export function deneigementAlerts(t: number, actions: readonly EnvAction[], source: SnowSource): Alert[]
  export function aqueducAlerts(t: number, actions: readonly EnvAction[]): Alert[]
  export function allAlerts(t: number, actions: readonly EnvAction[], source: SnowSource): Alert[]   // sorted: critique, attention, info, then most recent
  export function summarize(a: readonly Alert[]): Record<Severity, number>
  ```
  - Déneigement:
    - from 07:30 with no decision: « Neige prévue ce soir — décider l'interdiction de stationner » (attention). From 12:00 it becomes critique. The detail gives the quantity and the source (« prévision Environnement Canada » or « Simulation »).
    - from 15:00 with no visitor decision and no default (impossible with the default, but kept for the model): « Trop tard pour ce soir ».
    - from 23:00 to 06:00: « Interdiction en vigueur dans N zones » (info).
  - Aqueduc:
    - from 14:01 until isolation (visitor `isolate` or the intervention step): « Bris de conduite 13C1949 · Centre-ville » (critique, `focus: {kind:"incident", id:"13C1949"}`);
    - then « Réparation en cours » (attention) until restoration.

- [ ] **Step 1: Write the failing tests.** Here `d = SCENARIO_DAY` and `sim = {kind:"simulation", cm:12}`.
  - `snowPlan(atHour(d,"02:00"), [], sim)`: all three zones `en-vigueur` with `allume`, `decidedBy: "direction"`.
  - `snowPlan(atHour(d,"09:00"), [], sim)`: all `aucune`.
  - `snowPlan(atHour(d,"10:01"), [], sim)`: all `programmee`, `direction`.
  - With `[{at: atHour(d,"08:00"), kind:"ban", zones:["A"]}]`:
    - at 10:01 only A is `programmee` (`visiteur`), B and C `aucune`;
    - at 23:30, A is `en-vigueur` and `allume`.
  - Rewinding: with that same action, `snowPlan(atHour(d,"07:45"), …)` shows A as `aucune`.
  - A `ban` at 15:30 has no effect at 16:00.
  - Progress: a zone with 8 resources reaches 1 at 05:30; a zone with 4 is at 0.5 at 02:15.
  - `deneigementAlerts` at 08:00 with no action gives 1 attention; at 12:30 with no visitor action, none (the default decided at 10:00).
  - `aqueducAlerts` at 14:05 gives critique; at 15:10 attention; at 21:00 none.
  - `summarize` counts per severity.
  - `snowSource(null).kind === "simulation"`.
  - `snowSource` on a forecast with `snowCm` 6 gives `{kind:"eccc", cm:6}`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` → PASS.
- [ ] **Step 5: Commit** « Ajoute le modèle du déneigement et les alertes de la ville ».

### Task 5: Store commun et horloge partagée

**Files:**
- Create: `src/client/territoire/store.ts`, `src/client/territoire/useTerritoire.ts`, `tests/territoire-store.test.ts`
- Modify: `src/client/aqueduc/store.ts`, `useAq.ts`, `useAqueducStream.ts`, `scenarioController.ts`, `ui/Timeline.tsx`, `ui/AppBar.tsx`, `tests/aqueduc-*.test.ts` that use `clock`/`mode`

**Interfaces:**
- `territoireStore` (Zustand vanilla) holds:
  - `clock: { t0; speed: 1 | 60; startedAt }`;
  - `mode: "classic" | "hic"`;
  - `api: "absente" | "détectée" | "active"`;
  - `fallback: string`;
  - `actions: EnvAction[]`;
  - `env: EnvId | null`;
  - `forecast: Forecast | null | "chargement"`.

  It also provides these functions:
  - `simNow`, `setSpeed`, `seek`, `backToNow`, moved from the aqueduct store with the same signatures;
  - `act(a: Omit<EnvAction, "at">, now?)`, which timestamps the action with `simNow`;
  - `undoLast(kind)` (optional, for the panel).
- At start, `backToNow` puts the clock on real local time: « maintenant ».
- `aqueducStore` keeps only aqueduct state (layer, underground, selection, scenario, live, notices, benchTags, undergroundError).
- Its `incident` becomes derived: `currentIncident(t, actions, valves) = dayIncident(t, isolatedAt(actions, t), valves)`, where `isolatedAt` is the `at` of the last `isolate` returned by `actionsUpTo`. The stream reopens when the derived `incidentQuery` changes.
- The guided scenario no longer jumps to 06:57. `startScenario` seeks to `scenarioSteps(day).detection`, and `closeValves` records `act({kind:"isolate"})` once the server confirms.

- [ ] **Step 1: Write the failing tests** in `tests/territoire-store.test.ts` (Node, no React):
  - `act` timestamps with `simNow`;
  - `seek` before an action leaves `actionsUpTo` without it;
  - `currentIncident` at 14:30 after an `isolate` at 14:25 has closed valves;
  - `startScenario` then `exploreFreely` brings the clock and speed back.

  Adapt the existing `tests/aqueduc-*.test.ts` to the new times.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement and migrate the callers.** `grep -rn "aqueducStore.getState().clock\|s.clock\|s.mode\|\.api\b\|fallback" src`
- [ ] **Step 4: Run** `npm test` and `npm run typecheck` → PASS.
- [ ] **Step 5: Commit** « Partage l'horloge, le mode et les actions entre les environnements ».

### Task 6: Scène persistante, interface de module, Aqueduc migré

**Files:**
- Create:
  - `src/app/carte/layout.tsx`, `src/app/carte/[env]/page.tsx`
  - `src/client/territoire/scene/TerritoireScene.tsx`
  - `src/client/territoire/modules/types.ts`, `src/client/territoire/modules/aqueduc.tsx`, `src/client/territoire/modules/index.ts`
  - `src/client/territoire/shell/{AppBar,EnvSwitcher,Timeline}.tsx`
  - `src/client/territoire/theme.css`
- Modify:
  - `src/client/aqueduc/AqueducApp.tsx`: split. Map creation goes to `TerritoireScene`; the aqueduct layers, scene and panel become the module.
  - `src/app/layout.tsx`: import `theme.css`.
  - `tests/e2e/smoke.ts`: new URLs.
  - `bench/run-aqueduc.ts`, `scripts/aqueduc-proofs.ts`: URL `/carte/aqueduc?mode=…`.
  - `src/client/aqueduc/ui/PerfChip.tsx`: shown only with `?perf=1` or during the bench.

**Interfaces:**
- `modules/types.ts`:
  ```ts
  export interface SceneCtx { ml: typeof import("maplibre-gl"); map: import("maplibre-gl").Map; metrics: import("@/client/hic3d/metrics").Metrics }
  export interface EnvModule {
    id: EnvId;
    camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
    attribution: string[];                    // shown in MapLibre's attribution control while active
    mount(ctx: SceneCtx): () => void;         // sources, layers, subscriptions; returns a full unmount
    Scene: React.FC<{ ctx: SceneCtx }>;       // in-scene surfaces (HicHost in HIC mode, DOM in classic)
    Panel: React.FC<{ ctx: SceneCtx }>;       // layers + operations
    Inspector?: React.FC<{ ctx: SceneCtx }>;
  }
  export const MODULES: Partial<Record<EnvId, () => Promise<EnvModule>>>;   // in modules/index.ts, lazy import
  ```
- `TerritoireScene`:
  - creates the map once, with `START` at the active module's camera;
  - keeps it for the whole life of the layout and reads the environment from the URL (`useSelectedLayoutSegment` or equivalent, per the Next 16 docs);
  - on a change: unmounts the old module, flies (`flyTo`, 1.2 s) to the new module's camera, then mounts the new one;
  - exposes `window.__territoire = { map, env, store }` and keeps `window.__aqueduc` for the bench and the smoke test.
- `/carte/[env]/page.tsx`:
  - `generateStaticParams` over the lot-1 environments (`aqueduc`, `deneigement`);
  - `notFound()` for an unknown environment;
  - a lot-2 environment redirects to `/` (« À venir »).
  - Server-rendered content: title and summary of the environment, readable without JS, same principle as the current SSR summary.
- `EnvSwitcher`: a thumbnail button at the bottom left (komoot/Apple reference) that opens a popover with the 5 environments. Lot-2 entries are disabled and marked « À venir ». Navigation uses `router.push` with no reload. Keyboard: arrows and Échap.
- `AppBar`:
  - brand « Territoire · Trois-Rivières » with a « Démo » badge;
  - current environment;
  - search (lot 1: sectors, zones, pipes, sensors, resources);
  - mode switch (classic / HIC);
  - alert bell (Task 7);
  - ⓘ linking to `/a-propos`.
- `Timeline`: the aqueduct timeline made common, with ticks for the `DAY_TIMES` events (labelled tooltips) and the current time.
- `theme.css`: color tokens (light and dark), severities (`--sev-critique`, `--sev-attention`, `--sev-info`), states, spacing (4/8/12/16/24), radii, shadows. The aqueduct CSS consumes them; no visual regression on the pipes.

- [ ] **Step 1: Write the failing smoke checks** in `tests/e2e/smoke.ts` (server on 3300):
  - `/carte/aqueduc?mode=hic` reaches HIC mode with the API active.
  - Switching to `/carte/deneigement` through `EnvSwitcher` (click):
    - the URL changes;
    - `window.__territoire.map` is the same object (identity test through a marker `map.__id` set at creation);
    - the canvas is the same element;
    - the aqueduct layers (`aq-pipes`) are gone.
  - Back to Aqueduc: the layers are back.
  - `/carte/inconnu` returns 404.

  Until Task 8, Déneigement can be a module that shows only its title in the panel.
- [ ] **Step 2: Run smoke** → FAIL.
- [ ] **Step 3: Implement the layout, the scene, the interface, the aqueduct module, AppBar, EnvSwitcher, Timeline and the theme.** Keep the guided scenario, the cut, the underground view, export and the no-API banner working in the module.
- [ ] **Step 4: Run** `npm test`, `npm run typecheck`, `npm run build` (routes `/carte/aqueduc` and `/carte/deneigement` listed), and the full smoke → green. Every existing aqueduct check passes at the new URL.
- [ ] **Step 5: Commit** « Monte une scène persistante et branche l'aqueduc comme environnement ».

### Task 7: Accueil, cloche des alertes, « À propos »

**Files:**
- Create:
  - `src/client/territoire/shell/AlertBell.tsx`
  - `src/client/territoire/home/{Home.tsx,EnvCard.tsx,AlertsPanel.tsx}`
  - `src/app/a-propos/page.tsx`
  - `public/territoire/mini-{aqueduc,deneigement,collecte,zonage,evaluation}.png` (generated in Task 9; until then, a CSS placeholder)
- Modify: `src/app/page.tsx` (replaced by the home page), `src/client/shell/*` (old DemoNav removed or reduced), `tests/aqueduc-nav.test.ts` → `tests/territoire-nav.test.ts`

**Interfaces:**
- **Server render of `/`.** `src/app/page.tsx` computes at `Date.now()`, with no visitor actions, `allAlerts(t, [], snowSource(await getForecast()))`, plus a one-line state per environment:
  - Aqueduc: from `dayIncident`;
  - Déneigement: from `snowPlan` plus `ENVS`.

  It renders the home page readable without JS. On the client, the island recomputes with the visitor's store (actions, clock) every second of simulated time.
- **Home.** Layout follows the spec 5.3 sketch:
  - header « Vue d'ensemble · {date}, {heure} » and the « Simulation · Démo non officielle » badge;
  - `AlertsPanel`: severity summary (Searchable reference), list of alerts with « Ouvrir » → `/carte/{env}` + `focus`;
  - « À venir » (`nextEvents(t, 3)`);
  - weather (current conditions + tonight, or « Météo indisponible ») with its attribution;
  - 5 `EnvCard`s (lot 2 « À venir », not clickable);
  - footer « Démo non officielle · données ouvertes CC-BY 4.0 · À propos ».
- **`AlertBell`.** Count plus a dropdown with the list (Shopify reference). Clicking an alert navigates to the environment and applies `focus`: selection plus camera, read by the target module from `territoireStore.focus`.
- **`/a-propos`.** Mandatory content from spec 5.1:
  - the « non officielle » sentence word for word;
  - the sources table (aqueduct, night-parking zones, weather, basemap) with publisher, licence and link;
  - real vs simulated per environment;
  - the demo constants (decision times);
  - what HTML-in-Canvas shows;
  - a link to `/bench`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/territoire-nav.test.ts`: the home's environment list holds the 5 `ENVS` in order, and only `aqueduc` and `deneigement` carry an `href`.
  - In `smoke.ts`:
    - `/` without JS shows « Démo non officielle » and at least one alert or « Aucune alerte »;
    - clicking « Ouvrir » on the bris alert (clock placed at 14:05 with `window.__territoire.store` → `seek`) leads to `/carte/aqueduc` with the incident selected;
    - `/a-propos` contains the four licence lines;
    - with `/api/territoire/meteo` intercepted to return 500, the home shows « Météo indisponible ».
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, typecheck, build and smoke → green.
- [ ] **Step 5: Commit** « Ajoute l'accueil, la cloche des alertes et la page À propos ».

### Task 8: Environnement Déneigement

**Files:**
- Create in `src/client/territoire/modules/deneigement/`: `index.tsx` (module), `layers.ts`, `Scene.tsx`, `ZoneMark.tsx`, `Panel.tsx`, `Inspector.tsx`, `WeatherCard.tsx`
- Test: `tests/territoire-deneigement-layers.test.ts`, `tests/e2e/smoke.ts`

**Interfaces:**
- **Consumes:** `getDeneigementData` via `/api/territoire/deneigement`, `snowPlan`, `snowSource`, `banDeadlinePassed`, `FLEET`, `act`, `territoireStore.forecast`.
- **`layers.ts`:**
  - `applySnowLayers(map, data)`: sources `dn-zones` and `dn-lights`; layers `dn-zone-fill`, `dn-zone-line`, `dn-lights`.
  - `setZoneStates(map, plans: ZonePlan[])`, through `setFeatureState`.
  - `setLightStates(map, plans)`.
  - `blink(map, on: boolean)`: `allume` lights blink with a 1 s period through `circle-opacity` animated by `setPaintProperty` on a timer. The timer starts in `mount` and stops in the unmount.
  - Colors come from the theme:
    - zone `aucune`: neutral outline;
    - zone `programmee`: amber;
    - zone `en-vigueur`: orange;
    - lights: `eteint` grey, `programme` hollow amber, `allume` filled orange.
  - `removeSnowLayers(map)`.
- **`Scene`.** One ground mark per zone (HIC through `HicHost` and `placeGround`, as `SectorMark`; classic DOM through `ClassicScene`'s pattern). Its contents:
  - « Zone A »;
  - the state (« Stationnement interdit · 23 h – 6 h », « Interdiction ce soir », or nothing);
  - **one** figure: the number of lights on, or progress in %.

  It is clickable and focusable; it opens the zone inspector.
- **`Panel`.** These parts:
  - **Weather card:** source « Environnement Canada » or « Simulation », amount tonight, warning.
  - **« Interdiction de stationner cette nuit »:** checkboxes for zones A, B and C, then a « Décider pour ce soir » button (two gestures). The button is disabled after 15:00 with « Trop tard pour ce soir (limite 15 h) ». Once decided, it shows « Décidée à 10 h 00 par la direction (simulé) » or « par vous à … ».
  - **« Ressources » list:** type and depot for each resource, with an assignment `<select>` per zone, which calls `act({kind:"assign"})`.
  - Legend of the light states, carrying the mention « Simulation : feux inspirés du système de la Ville de Québec ».
- **`Inspector` (zone):**
  - state;
  - decided by / at;
  - lights by state;
  - assigned resources;
  - progress;
  - attribution of the zones.
- `window.__territoire.snow = { plans: () => ZonePlan[] }` for the smoke test.

- [ ] **Step 1: Write the failing tests.**

  Unit test: `setZoneStates` calls `setFeatureState` once per zone with `{ban}`. Use a fake map object that records its calls.

  Smoke tests:
  - On `/carte/deneigement?mode=hic` at 08:00 (seek), with the HIC API active:
    - check zones A and B, then click « Décider pour ce soir »;
    - A and B are `programmee` through `__territoire.snow.plans()`, and C is `aucune`;
    - the bell no longer shows « décider ».
  - Seek to 23:30: A and B `en-vigueur`; the `dn-lights` features of A are `allume` (`querySourceFeatures` + feature-state).
  - Seek to 16:00 on a fresh page: the button is disabled with « Trop tard ».
  - Clicking the HIC mark of zone A opens the inspector « Zone A ».
  - Classic mode: same checks, minus HIC.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, typecheck, build and smoke → green.
- [ ] **Step 5: Commit** « Ajoute l'environnement Déneigement ».

### Task 9: Preuves, vidéo, banc, documentation

**Files:**
- Modify:
  - `scripts/aqueduc-proofs.ts` → renamed `scripts/territoire-proofs.ts` (`npm run proofs:territoire`); keep `proofs:aqueduc` as an alias;
  - `docs/aqueduc/*` → `docs/territoire/*` for new proofs;
  - `public/aqueduc/scenario-hic.webm` → `public/territoire/visite-hic.webm`, and `VIDEO_URL` follows;
  - `README.md`, `CAPABILITIES.md`, `data/aqueduc/SOURCE.md` (link to `data/territoire/SOURCE.md`);
  - `bench/run-aqueduc.ts` (URL only).
- Generate: `public/territoire/mini-*.png` (the 5 home thumbnails, 2× capture of each environment's camera; lot 2: capture of the base camera with « À venir »).

**Interfaces:**
- **Proofs.** These captures:
  - home (light), with its alerts;
  - Aqueduc HIC;
  - Déneigement HIC at 23:30 with A and B in force;
  - inspector of zone A;
  - switching between environments (2 images of the same canvas);
  - no-API view.

  `proofs.json` records the environment (browser, WebGL, `"gpu": false`) and `sameMapAcrossEnvs: true`.
- **Video « visite » (10–15 s).** Home → Aqueduc (bris) → Déneigement (decision, then 23:30). It is recorded with `recordMap` for the map parts and the credit strip; the home part is captured by Playwright and assembled with ffmpeg, already used. The credits are the union of the active attributions.
- **README.** Rewritten for the territory tool:
  - what it is and the 5 environments, including lot 2 « À venir »;
  - how to run it;
  - data and licences, including the weather;
  - commands (`territoire:data`, `aqueduc:data`, `proofs:territoire`, `bench:aqueduc`, tests, smoke);
  - Docker;
  - Origin Trial token.
- **CAPABILITIES.** Reoriented toward HTML-in-Canvas's possibilities in territory management:
  - matrix by environment;
  - the existing measurements kept, without GPU, in a secondary section.

- [ ] **Step 1: Run the proofs and generate the thumbnails and the video.** Look at each image: the step is checked when every image shows what the list above describes.
- [ ] **Step 2: Write the docs** from the real results.
- [ ] **Step 3: Verify:**
  - `npm test`;
  - `npm run typecheck`;
  - `npm run build`;
  - the full smoke;
  - `npm run bench:aqueduc -- --quick` (or a short campaign if the script has no such option: one config per mode), which proves the bench still runs;
  - a Docker build (local proxy variant if needed, versioned `Dockerfile` unchanged), with a healthy container and `/`, `/carte/aqueduc`, `/carte/deneigement`, `/a-propos`, `/api/territoire/meteo` returning 200.
- [ ] **Step 4: Commit** « Documente l'outil de gestion du territoire et refait les preuves ».
