# Mur de supervision — HTML-in-Canvas vs DOM virtualisé

Démo d'apprentissage de l'API expérimentale **HTML-in-Canvas** (Chrome/Edge) dans un contexte
réaliste : un canvas infini et zoomable de **1 000 cartes HTML** (200 succursales fictives ×
5 indicateurs), alimentées par cinq sources hétérogènes à des fréquences différentes.

Le même mur, avec le même store et les mêmes composants React, est rendu de deux façons :

| Mode | Rendu |
|---|---|
| **DOM** (référence) | cartes en `<div>` dans un monde transformé en CSS, virtualisation (seules les cartes visibles sont montées) |
| **HTML-in-Canvas** | cartes HTML montées dans `<canvas content="drawable">`, capturées en textures WebGL2 par un planificateur de recaptures, zoom sémantique |

> ⚠️ **Toutes les données sont simulées** (succursales, chiffres, avis, responsables). Un bandeau
> le rappelle à l'écran.

Le livrable principal est **[RULES.md](RULES.md)** : quand et comment utiliser HTML-in-Canvas
dans un dashboard, chiffres du banc à l'appui.

## Démarrer

```bash
cp .env.example .env
```

```bash
docker compose up -d db
```

```bash
npm install
```

```bash
npm run db:setup
```

```bash
npm run dev
```

Puis ouvrir <http://localhost:3000> (paramètres : `?n=250|500|1000`, `?mode=dom|canvas`).
`npm run db:setup` applique les migrations Drizzle et le seed (idempotent ; `db:migrate` et
`db:seed` séparément). Sans Postgres joignable, l'application fonctionne quand même : les notes
sont gardées en mémoire et la barre d'outils l'indique.

Pages :

| URL | Contenu |
|---|---|
| `/` | le mur (vue d'ensemble SSR + mur client) |
| `/lab` | une seule carte HTML-in-Canvas, avec les mesures de l'API (unité, captures, vérification) |
| `/bench` | résultats du banc (graphiques + tableaux), CSV dans `/bench/results.csv` |

Interactions : molette = zoom au curseur, glisser = déplacer, `+`/`-`/flèches au clavier,
clic sur une carte intermédiaire = ouvrir son panneau complet (Échap pour fermer), Tab parcourt
les champs des cartes rapprochées (la caméra suit le focus).

## Activer l'API

| Navigateur | Comment |
|---|---|
| Chrome Canary / Dev | `chrome://flags/#canvas-draw-element` → *Enabled*, relancer |
| Ligne de commande (Playwright, CI) | `--enable-blink-features=CanvasDrawElement` |
| Simuler un Chrome **sans** l'API | `--disable-blink-features=CanvasDrawElement` |
| Production | jeton d'Origin Trial (balise `<meta http-equiv="origin-trial">`), non fourni ici |

Constat : le Chromium 158 fourni avec Playwright 1.63 expose déjà l'API **sans flag** ;
`--disable-blink-features=CanvasDrawElement` la retire bien (le nom de la fonctionnalité Blink
derrière le flag est donc `CanvasDrawElement`). Le banc passe tout de même
`--enable-blink-features=CanvasDrawElement` pour rester valable sur les versions où elle est
désactivée par défaut.

Testez sur `localhost`, jamais dans un iframe sandboxé : l'API peut y être détectée sans
transmettre aucun pixel (texture noire). L'application le détecte (voir plus bas) et bascule
en mode DOM avec la raison affichée.

## Architecture

```
 sources                     store unique                 DOM = source de vérité
 ───────                     ────────────                 ──────────────────────
 SSE  /api/sales/stream ──┐                               composants <Card> React
 poll /api/staff    60 s ─┤   lot appliqué 1×/frame       (mêmes en DOM et en canvas)
 poll /api/reviews  15 min┼─► Zustand (état React)  ───►  ├─ mode DOM : <div> virtualisées
 poll /api/weather  1 h ──┤   LiveState (hors React):     └─ mode canvas : portail dans
 Server Actions (notes,   │   statuts, sparklines,           <canvas content="drawable">
 responsable, alerte) ────┘   dirty flags + versions                 │
                                                                     ▼ évènement `paint`
                                     planificateur de recaptures (file de priorité, budget)
                                                                     │ texElementSubImage2D
                                                                     ▼
                                     textures (atlas 2048² ou 1 par carte, LRU 256 Mo)
                                                                     │
                                                                     ▼
                         WebGL2 brut : régions + tuiles instanciées + quads texturés
                                       (fondu 160 ms) + sparklines (jamais capturées)
```

- **Sources** (`src/app/api/*`) : chaque source a sa route. Les sources « polling » sont sans
  état côté serveur (valeur = fonction du tick demandé), le SSE simule chaque succursale à
  1–5 s d'intervalle, divisé par la vitesse (×1, ×10, ×100). « Tempête » (`POST /api/storm`)
  modifie 30 % des cartes d'un coup. Écritures par Server Actions (`src/app/actions.ts`),
  lectures par `/api/notes`, `/api/assign`, `/api/alerts`.
- **Store** (`src/client/store.ts`) : les messages s'accumulent puis sont appliqués **une fois
  par frame** (un seul `setState`, un seul rendu React). Chaque carte a une signature de ce
  qu'affiche son HTML ; si elle change, la carte devient *dirty* et sa version augmente.
- **Mode DOM** (`src/client/wall/DomWall.tsx`) : même zoom sémantique, virtualisation avec
  8 % de marge, sparkline en SVG.
- **Mode HTML-in-Canvas** (`src/client/wall/CanvasWall.tsx`, `src/client/hic/*`) :
  - niveau éloigné (< 25 %) : aucune carte montée, 1 000 tuiles WebGL en un appel ;
  - intermédiaire (25–70 %) : version légère (204×138 px CSS, 36 % des texels) ;
  - rapproché (> 70 %) : panneau complet (340×230 px CSS) avec mini-tableau, dernier avis,
    `<textarea>`, `<select>`, bouton.
  - La sparkline des ventes est dessinée en WebGL par-dessus la texture : un nouveau point ne
    provoque aucune recapture.
  - Rendu à la demande : sans changement, ni `requestPaint()` ni redessin.
- **Planificateur** (`src/client/hic/scheduler.ts`) : focus (hors budget) > rapprochée
  manquante > rapprochée périmée > intermédiaire manquante > intermédiaire périmée, puis
  ancienneté ; budget par frame en captures **et** en ms (curseurs de la barre d'outils). Les
  cartes hors écran ne sont jamais recapturées : leur dirty flag attend leur retour.

### Hydratation React

La page serveur ne rend que la vue d'ensemble (HTML sémantique, lisible sans JavaScript). Le
mur est chargé par `next/dynamic` avec `ssr: false`, donc **monté après l'hydratation**. Les
cartes du mode canvas sont ensuite insérées dans le `<canvas>` par `createPortal` : React les
possède (état, évènements, Server Actions fonctionnent normalement), mais aucun nœud du canvas
ne passe par l'hydratation, ce qui évite tout décalage serveur/client (le contenu du canvas
dépend de la caméra et de l'API, inconnues côté serveur). L'attribut `drawable` est posé par
React à la création de l'élément, avant son insertion.

### Garde-fous de l'API

1. Détection : `texElementSubImage2D` (actuelle) ou `texElementImage2D` (ancienne).
2. Après chaque upload des trois premières captures puis une sur 250 : lecture de quelques
   texels (framebuffer + `readPixels`). Texture vide → bascule en mode DOM, raison affichée.
3. Aucun évènement `paint` dans les 2,5 s qui suivent le premier `requestPaint()` → mode DOM.
4. Cinq uploads consécutifs en erreur → mode DOM.

Le badge de la barre d'outils passe de *absente* / *détectée* à *active et vérifiée* après la
première vérification réussie.

## Banc de mesures et vérification

```bash
npm run build
```

```bash
PORT=3100 npm start
```

```bash
BASE_URL=http://localhost:3100 REPEAT=2 npm run bench
```

Le parcours fixe (vitesse ×10) : vue d'ensemble → zoom sur une région → pan sur toute la
région → zoom sur une carte → saisie dans la note → dézoom → « Tempête » (+ une tempête au
niveau intermédiaire, en supplément). Variables : `COUNTS=250,500,1000`,
`CONFIGS=dom,canvas-atlas,canvas-percard`, `SPEEDS=10`, `BUDGETS=12:6`, `CAMPAIGN`,
`APPEND=1`. Résultats dans `bench/results/results.csv` (+ `meta.json`), affichés sur `/bench`.

Vérification fonctionnelle (deux modes, repli sans API, SSR sans JavaScript) :

```bash
BASE_URL=http://localhost:3100 npx tsx tests/e2e/verify.ts
```

Tests unitaires (simulation, store, planificateur) :

```bash
npm test
```

## Docker / Coolify

```bash
docker build -t mur-supervision .
```

```bash
docker compose --profile app up
```

Image `node:22-alpine`, build standalone, utilisateur non root, `HEALTHCHECK`. Variables :
`DATABASE_URL`, `DB_AUTO_SETUP=1` (migrations + seed au démarrage via `instrumentation.ts`).
Sur Coolify : déployer le `Dockerfile`, ajouter un service Postgres et renseigner ces deux
variables.

## Limites connues de l'API (constatées sur Chromium 158)

Détails et mesures dans [RULES.md](RULES.md#pièges-et-écarts-entre-la-documentation-et-le-comportement-réel).

- `captureElementImage()` renvoie un `ElementImage` qui **n'expose pas sa taille** (seulement
  `close()`) : il faut la calculer (`offsetWidth × canvas.width / canvas.clientWidth`).
- La capture est en **pixels du backing store** ; une texture plus petite que la capture donne
  `INVALID_VALUE` et **rien n'est copié** (texture noire, sans exception).
- `texElementSubImage2D` hors d'un paint lève « No cached paint record for element » tant que
  l'élément n'a jamais été peint ; il faut uploader dans le handler `paint`.
- `canvasTransform` de `updateElementGeometry` est en **px CSS** du canvas (et non en pixels
  du backing store), y compris avec un DPR de 2.
- Sans géométrie, tous les enfants `drawable` sont à l'origine du canvas pour le hit testing :
  ils interceptent les clics dans ce coin.
- `texElementImage2D` (ancienne API d'upload) est absent de Chrome 158, alors que
  `getElementTransform` existe encore à côté de `updateElementGeometry`. Le chemin de repli
  « ancienne API » est codé mais n'a pas pu être exécuté de bout en bout ici.
- Aucune mipmap automatique : une texture intermédiaire vue à 25 % scintille un peu.
