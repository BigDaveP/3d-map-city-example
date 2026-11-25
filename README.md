# Réseau d'eau potable 3D · HTML-in-Canvas

Démo d'apprentissage de l'API expérimentale **HTML-in-Canvas** (Chrome/Edge) : du vrai HTML
(boutons, focus, lecteurs d'écran) dessiné dans une scène WebGL 3D, comparé à une version
classique en DOM. Le sujet : le **vrai réseau d'aqueduc de Trois-Rivières** vu par un directeur
des travaux publics, avec des capteurs et un bris de conduite **simulés**.

| URL | Page |
|---|---|
| `/` | La démo : réseau d'eau potable 3D, mode classique ou HTML-in-Canvas |
| [`/bench`](http://localhost:3000/bench) | Banc de mesures de la démo : classique vs HTML-in-Canvas (graphiques, tableaux, CSV) |

La barre de chaque page renvoie à l'autre ; « À propos » dit ce qu'on regarde, ce qui est simulé
et quoi essayer. Bilan écrit : **[CAPABILITIES.md](CAPABILITIES.md)** (matrice des capacités,
preuves, mesures, conclusion). **[RULES.md](RULES.md)** rassemble les règles d'emploi de
l'API tirées d'une étude précédente (un mur de supervision, retiré depuis du dépôt).

## La démo

Le réseau réel compte 24 137 tronçons de conduites. Les capteurs sont **simulés** : 30 de
pression, 10 débitmètres, 10 stations de qualité de l'eau (chlore résiduel, turbidité, pH),
11 sondes de réservoir, et 10 secteurs de distribution nommés d'après les quartiers.

- **Exploration libre** d'un réseau vivant : horloge simulée (temps réel ou ×60), frise de 24 h,
  couches (pression, qualité de l'eau, âge et matériau, rinçage 2026, incidents), fiche du
  tronçon, du capteur ou du secteur sélectionné.
- **Scénario guidé de bris** (bouton « Lancer le scénario de bris ») sur la conduite maîtresse
  13C1949 : détection, isolation (coupe sous la chaussée, vannes à fermer), intervention,
  rétablissement, rapport avec export vidéo. « Explorer librement » rend la main à tout moment.
- **Vue souterraine** : de vrais tubes 3D sous les rues (WebGL2, même tampon de profondeur que
  la carte), diamètres exagérés ×12 et indiqués à l'écran ; conduites maîtresses et
  centre-ville par défaut, « Tout le réseau » en option.
- **Deux modes, même vue** (bascule « Classique / HTML-in-Canvas » dans la barre) :
  - classique : noms de secteurs et étiquettes des capteurs en marqueurs DOM plats, toujours
    au premier plan ;
  - HTML-in-Canvas : les mêmes composants React, couchés au sol ou face caméra dans la scène 3D,
    masqués par les bâtiments, cliquables et accessibles au clavier.

Toute mesure, débit, adresse desservie, vanne et incident est **simulé** et étiqueté comme tel ;
seul le tracé des conduites est réel. Chaque visiteur a son propre état (un bris déclenché par
un visiteur n'apparaît pas chez les autres).

## Lancer

```bash
npm install
```

```bash
npm run dev
```

Ouvrir <http://localhost:3000/> : HTML-in-Canvas si le navigateur l'active, sinon mode classique
(forcer un mode : `?mode=classic` ou `?mode=hic`). Aucune base de données ni service externe
n'est nécessaire, à part les tuiles du fond de carte : le réseau est versionné dans
`data/aqueduc/`. Sans JavaScript, la page affiche un résumé de l'état du réseau rendu par le
serveur.

Sans l'API, la page reste en mode classique et un bandeau propose « Voir la version
HTML-in-Canvas en vidéo » (`public/aqueduc/scenario-hic.webm`) et « Comment l'activer ».

## Données et attribution

- **Conduites d'eau potable**, Ville de Trois-Rivières, publiées sur
  [Données Québec](https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e),
  licence **CC-BY 4.0**. Attribution affichée partout où les conduites apparaissent (carte,
  résumé sans JavaScript, bandeau des vidéos exportées) : « Conduites : Ville de Trois-Rivières,
  Données Québec, CC-BY 4.0 ».
- **Fond de carte** : [OpenFreeMap](https://openfreemap.org) (style « liberty », bâtiments
  extrudés), © OpenMapTiles, données © OpenStreetMap. Les conditions d'OpenFreeMap autorisent
  l'intégration gratuite mais interdisent la collecte automatisée : le banc et les preuves
  chargent la carte quelques dizaines de fois, pas plus (profil Chromium avec cache HTTP).
- Extraction, champs conservés et sources des seuils d'alerte :
  [data/aqueduc/SOURCE.md](data/aqueduc/SOURCE.md).

## Commandes de la démo

Le banc et les preuves visent un serveur de production ; `BASE_URL` vaut
`http://localhost:3300` par défaut :

```bash
npm run build
```

```bash
PORT=3300 npm start
```

| Commande | Effet |
|---|---|
| `npm run aqueduc:data` | Retélécharge les conduites depuis Données Québec et réécrit `data/aqueduc/trois-rivieres.json` et `SOURCE.md` (la section des seuils est conservée). Inutile pour lancer la démo. Derrière un proxy TLS : `NODE_EXTRA_CA_CERTS`. |
| `npm run bench:aqueduc` | Banc classique vs HTML-in-Canvas (20, 60, 120 étiquettes ; rotation, caméra immobile, scénario ; vue souterraine). Écrit `bench/results/aqueduc.csv` et `aqueduc-meta.json`, affichés sur [`/bench`](http://localhost:3000/bench#aqueduc). Environ 12 min. Variables : `REPEAT`, `TAGS`, `MODES`, `SCALE`, `UNDERGROUND=0`. |
| `npm run proofs:aqueduc` | Régénère les captures, les vidéos WebM et `docs/aqueduc/proofs.json` (occlusion, clic masqué, arbre ARIA, focus clavier, repli sans l'API), et copie la vidéo du scénario dans `public/aqueduc/`. Demande `ffmpeg` et `ffprobe` pour les images extraites des vidéos. |

## Banc de mesures

La page [`/bench`](http://localhost:3000/bench) affiche les résultats de `npm run bench:aqueduc`
versionnés dans `bench/results/` : graphiques par nombre d'étiquettes, tableaux détaillés (dont
la vue souterraine) et CSV à télécharger (`/bench/aqueduc.csv`). La puce de performance de la
démo (images/s, temps JS) y renvoie. Les résultats publiés ont été mesurés **sans GPU** (WebGL
logiciel) : leur lecture est dans [CAPABILITIES.md](CAPABILITIES.md#mesures-sans-gpu-swiftshader).

## Tests et vérification

Tests unitaires (simulation, graphe et isolation, réseau, couleurs, tubes, géométrie, mesures,
export vidéo, navigation) :

```bash
npm test
```

```bash
npm run typecheck
```

Vérification de bout en bout (Chromium de Playwright) contre un serveur de production : vue sans
JavaScript, 390 px, deux modes, vue souterraine, scénario, barre à plusieurs largeurs, bandeau
sans l'API, repli, `/bench` :

```bash
BASE_URL=http://localhost:3300 npx tsx tests/e2e/smoke.ts
```

Variables facultatives de captures (`SHOT`, `SHOT_HIC`, `SHOT_SCENARIO_HIC`…) : voir l'en-tête
de `tests/e2e/smoke.ts`.

## Activer l'API

| Navigateur | Comment |
|---|---|
| Chrome Canary / Dev | `chrome://flags/#canvas-draw-element` → *Enabled*, relancer |
| Ligne de commande (Playwright, CI) | `--enable-blink-features=CanvasDrawElement` |
| Simuler un Chrome **sans** l'API | `--disable-blink-features=CanvasDrawElement` |
| Production | jeton d'Origin Trial : variable d'environnement `HIC_ORIGIN_TRIAL_TOKEN` |

**Jeton d'Origin Trial.** Si `HIC_ORIGIN_TRIAL_TOKEN` est définie à l'exécution, le layout ajoute
`<meta http-equiv="origin-trial" content="…">` à toutes les pages (`src/lib/origin-trial.ts`) ;
sans jeton, rien ne change. Le jeton est lié au domaine d'hébergement : en demander un pour ce
domaine, puis par exemple `docker run -e HIC_ORIGIN_TRIAL_TOKEN=… …` (en local : copier
`.env.example` en `.env`). Aucun jeton n'est fourni ici.

Constat : le Chromium 158 fourni avec Playwright 1.63 expose déjà l'API **sans flag** ;
`--disable-blink-features=CanvasDrawElement` la retire bien (le nom de la fonctionnalité Blink
derrière le flag est donc `CanvasDrawElement`). Le banc et les preuves passent tout de même
`--enable-blink-features=CanvasDrawElement` pour rester valables sur les versions où elle est
désactivée par défaut.

Testez sur `localhost`, jamais dans un iframe sandboxé : l'API peut y être détectée sans
transmettre aucun pixel (texture noire). La démo le détecte (lecture de texels après upload) et
bascule en mode classique avec la raison affichée.

## Architecture

- **Carte** : MapLibre GL JS 6 (`src/client/aqueduc/`), caméra inclinée, bâtiments extrudés ;
  les conduites sont des couches MapLibre colorées par `setFeatureState` à chaque message du
  flux SSE des capteurs (`/api/aqueduc/stream`). Le modèle simulé est calculé côté serveur
  (`src/lib/aqueduc/`, `src/server/aqueduc.ts`).
- **HTML-in-Canvas** (`src/client/hic3d/`) : les étiquettes sont de vrais éléments React montés
  dans le canvas de MapLibre (`content="drawable"`), capturés dans le handler `paint`
  (`texElementSubImage2D`, en **restaurant l'état GL** que MapLibre garde en cache) et dessinés
  par une custom layer en `renderingMode: "3d"` qui partage le **tampon de profondeur** des
  bâtiments. `updateElementGeometry` reçoit une matrice projective 4×4 : le hit testing suit la
  perspective ; des requêtes d'occlusion WebGL2 le complètent (voir CAPABILITIES.md).
- **Pièges** : dans la custom layer, la matrice à utiliser est
  `defaultProjectionData.mainMatrix` (avec `modelViewProjectionMatrix`, des coordonnées Mercator
  0..1 s'effondrent en un point) ; le worker de MapLibre 6, chargé via
  `new URL(..., import.meta.url)`, est réécrit par Turbopack et relançait le rechargement à chaud
  en boucle : il est servi tel quel par `/maplibre/[file]` (`setWorkerUrl`).

## Docker / Coolify

```bash
docker build -t aqueduc-3d .
```

```bash
docker run -p 3000:3000 aqueduc-3d
```

Ou, avec le même `Dockerfile` :

```bash
docker compose up --build
```

Image `node:22-alpine`, build standalone, utilisateur non root, `HEALTHCHECK` sur
`/api/aqueduc/series`. Le réseau (données versionnées), les résultats du banc et la vidéo de
`public/aqueduc/` y sont inclus. Seule variable, facultative : `HIC_ORIGIN_TRIAL_TOKEN` (voir
« Activer l'API »). Sur Coolify : déployer le `Dockerfile` et renseigner le jeton si besoin.

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
- Le hit testing suit `canvasTransform` mais **ignore la profondeur WebGL** : une surface cachée
  derrière un bâtiment reçoit les clics tant qu'on ne la neutralise pas soi-même.
- `texElementImage2D` (ancienne API d'upload) est absent de Chrome 158, alors que
  `getElementTransform` existe encore à côté de `updateElementGeometry`. Le chemin de repli
  « ancienne API » est codé mais n'a pas pu être exécuté de bout en bout ici.
- Aucune mipmap automatique : les marquages au sol, vus en biais, génèrent les leurs après
  chaque capture.
