# RULES.md — HTML-in-Canvas dans un dashboard : quand et comment

Ce document répond à une question : **quand et comment utiliser HTML-in-Canvas dans un
dashboard ?** Il s'appuie sur un mur de supervision (1 000 cartes, 5 sources de données
simulées) mesuré par un banc Playwright. Le mur, son banc et ses résultats ont depuis été
retirés du dépôt, qui ne garde que la démo réseau d'eau (`/`) ; on les retrouve dans
l'historique git, jusqu'au commit `da1c01b` (`src/client/wall/`, `bench/run-bench.ts`,
`bench/results/results.csv`). Les règles ci-dessous valent toujours pour HTML-in-Canvas et
guident la démo réseau d'eau (bilan dans [CAPABILITIES.md](CAPABILITIES.md)).

## En bref

1. **Le DOM virtualisé avec zoom sémantique suffit.** Il a tenu 60 FPS (p95 16,8 ms) dans
   toutes les configurations mesurées : 250 à 1 000 cartes, vitesse ×1 à ×100, tempête sur 30 %
   des cartes, et jusqu'à 5 000 cartes en extrapolation. Le mode HTML-in-Canvas n'a été plus
   rapide dans **aucun** cas : 45 à 57 FPS sur le parcours, latence p95 de 64 à 141 ms contre
   15 à 26 ms en DOM.
2. **HTML-in-Canvas n'est pas une optimisation de performance pour des cartes de texte qui
   changent souvent.** Une capture coûte 0,5 à 0,9 ms de thread principal ; le DOM met à jour
   les mêmes cartes visibles pour 1 à 6 ms **au total** par frame.
3. **Utilisez-le quand le rendu doit être WebGL** (shaders, transitions, 3D, scènes de
   dizaines de milliers d'objets) et qu'il faut y mêler du vrai HTML : texte mis en page,
   formulaires, focus, accessibilité. Le HTML capturé est alors réservé à ce qui change
   rarement ou à ce qui est en cours d'édition.
4. **Ce qui change à chaque frame ou à chaque donnée reste en WebGL** : couleurs de statut,
   sparklines, position, fondus. Le HTML capturé ne doit pas bouger tout seul.
5. **Budget de recaptures : 8 à 12 captures et au plus 6 ms par frame**, la carte qui a le
   focus hors budget. En dessous, la file déborde (latence p95 de 0,8 s) ; au-dessus, le temps
   JS dépasse la frame sans gain de latence.
6. **Rendu à la demande obligatoire** : sans changement, ni `requestPaint()` ni redessin. Le
   redessin systématique coûtait 25 FPS dans ce conteneur.
7. **Toujours vérifier les pixels après upload** et prévoir le repli DOM : l'API peut être
   présente sans transmettre aucun pixel, et une texture trop petite échoue en silence.

## Méthode et environnement

- **Machine** : conteneur Linux, 4 vCPU Xeon 2,1 GHz, 17 Go, **sans GPU**. WebGL2 passe par
  ANGLE + SwiftShader (Vulkan logiciel). Chromium 158.0.8127.36 (Playwright 1.63, headless),
  vue 1600×900, DPR 1, `--enable-blink-features=CanvasDrawElement --enable-precise-memory-info`.
- **Étalon** : un canvas WebGL2 plein écran (1600×900) effacé à chaque frame tient 60 FPS
  (p95 16,8 ms). Le coût fixe de la plateforme est donc nul ; les écarts mesurés viennent du
  travail réel (remplissage de pixels, captures, montage React).
- **Parcours fixe** à vitesse ×10 : vue d'ensemble (3 s) → zoom sur une région à 35 % →
  pan en serpentin sur toute la région → zoom sur une carte à 100 % → saisie de 60 caractères
  dans la note → dézoom → « Tempête » en vue d'ensemble. Une phase supplémentaire, hors
  cahier des charges, déclenche une tempête au niveau intermédiaire, où 30 % des cartes
  visibles sont à recapturer.
- **Configurations** : DOM virtualisé ; HTML-in-Canvas avec atlas de textures ;
  HTML-in-Canvas avec une texture par carte. Budget par défaut : 12 captures / 6 ms par frame.
  2 répétitions (moyennées) pour 250, 500 et 1 000 cartes ; 1 pour 2 500 et 5 000.
- **Mesures** : intervalle entre frames (FPS, p50, p95) ; temps JS par frame (rAF + commit
  React + handler `paint`) ; latence donnée → pixel, comptée de la réception du message à la
  frame qui l'affiche, uniquement pour une carte déjà affichée au moment de la réception (même
  définition dans les deux modes, présentation à l'écran exclue) ; captures ; taille de file ;
  mémoire des textures (estimée : texels × 4 octets, pages d'atlas comprises) ; tas JS ;
  nœuds DOM.

**Limite principale.** Sans GPU, chaque pixel dessiné coûte du CPU : les FPS du mode canvas
sont pessimistes par rapport à une machine équipée. Les temps JS, le nombre de captures, la
latence de la file et la mémoire ne dépendent pas du GPU et restent comparables.

## Résultats du banc

### Parcours complet

\* extrapolation au-delà du cahier des charges (DOM et atlas seulement). « Frame p95 » et
« JS p95 » sont les pires phases du parcours ; les autres colonnes sont des moyennes pondérées.

| Cartes | Configuration | FPS | Frame p50 | Frame p95 | JS p95 | Latence p50 | Latence p95 | Captures | ms/capture | Textures (Mo) | Tas JS (Mo) | Nœuds DOM max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 250 | DOM virtualisé | 59,9 | 16,7 | 16,8 | 1,1 | 7 | 16 | 0 | 0,00 | 0 | 13 | 1 126 |
| 250 | Canvas + atlas | 56,8 | 16,7 | 33,3 | 8,9 | 15 | 70 | 850 | 0,87 | 32 | 14 | 993 |
| 250 | Canvas, 1 texture/carte | 57,0 | 16,7 | 33,4 | 9,9 | 15 | 64 | 841 | 0,85 | 20 | 15 | 1 197 |
| 500 | DOM virtualisé | 59,9 | 16,7 | 16,8 | 1,4 | 8 | 26 | 0 | 0,00 | 0 | 14 | 1 281 |
| 500 | Canvas + atlas | 54,4 | 16,7 | 33,4 | 10,2 | 17 | 75 | 1 010 | 0,85 | 48 | 14 | 1 074 |
| 500 | Canvas, 1 texture/carte | 53,9 | 16,7 | 33,4 | 10,6 | 17 | 127 | 1 015 | 0,83 | 27 | 15 | 1 202 |
| 1000 | DOM virtualisé | 59,8 | 16,7 | 16,8 | 2,3 | 7 | 15 | 0 | 0,00 | 0 | 21 | 1 538 |
| 1000 | Canvas + atlas | 50,9 | 17,1 | 50,0 | 10,3 | 17 | 125 | 1 237 | 0,82 | 80 | 16 | 1 236 |
| 1000 | Canvas, 1 texture/carte | 50,5 | 17,2 | 50,0 | 10,3 | 18 | 91 | 1 210 | 0,81 | 41 | 16 | 1 265 |
| 2500* | DOM virtualisé | 59,8 | 16,7 | 16,8 | 4,6 | 9 | 17 | 0 | 0,00 | 0 | 38 | 2 694 |
| 2500* | Canvas + atlas | 45,7 | 21,9 | 83,4 | 11,2 | 18 | 141 | 1 699 | 0,74 | 112 | 24 | 1 344 |
| 5000* | DOM virtualisé | 59,9 | 16,7 | 16,8 | 5,7 | 8 | 19 | 0 | 0,00 | 0 | 43 | 3 154 |
| 5000* | Canvas + atlas | 44,8 | 21,7 | 83,4 | 13,4 | 17 | 115 | 1 975 | 0,70 | 160 | 26 | 1 344 |

### Par phase, 1 000 cartes

| Phase | Config | FPS | Frame p95 | JS p95 | Latence p95 | Captures | File max | Cartes montées | Nœuds DOM |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1-vue-ensemble | DOM virtualisé | 60,0 | 16,7 | 1,1 | 0 | 0 | 0 | 1 000 | 1 174 |
| 1-vue-ensemble | Canvas + atlas | 52,0 | 33,3 | 0,6 | 0 | 0 | 0 | 0 | 169 |
| 1-vue-ensemble | Canvas, 1 texture/carte | 52,0 | 33,4 | 0,6 | 0 | 0 | 0 | 0 | 169 |
| 2-zoom-region | DOM virtualisé | 59,3 | 16,8 | 1,9 | 11 | 0 | 0 | 1 000 | 1 174 |
| 2-zoom-region | Canvas + atlas | 40,6 | 41,7 | 10,3 | 125 | 103 | 120 | 144 | 1 005 |
| 2-zoom-region | Canvas, 1 texture/carte | 40,8 | 41,7 | 10,3 | 80 | 105 | 119 | 144 | 1 005 |
| 3-pan-region | DOM virtualisé | 60,0 | 16,8 | 1,2 | 13 | 0 | 0 | 132 | 1 538 |
| 3-pan-region | Canvas + atlas | 44,5 | 33,4 | 8,6 | 51 | 581 | 6 | 132 | 1 236 |
| 3-pan-region | Canvas, 1 texture/carte | 43,1 | 33,4 | 7,6 | 48 | 570 | 8 | 132 | 1 236 |
| 4-zoom-carte | DOM virtualisé | 59,0 | 16,8 | 1,1 | 14 | 0 | 0 | 81 | 1 002 |
| 4-zoom-carte | Canvas + atlas | 48,0 | 33,4 | 8,8 | 30 | 102 | 22 | 81 | 880 |
| 4-zoom-carte | Canvas, 1 texture/carte | 46,5 | 33,4 | 8,8 | 47 | 99 | 22 | 81 | 961 |
| 5-saisie-note | DOM virtualisé | 60,0 | 16,8 | 0,8 | 15 | 0 | 0 | 12 | 642 |
| 5-saisie-note | Canvas + atlas | 58,9 | 16,8 | 3,0 | 33 | 110 | 0 | 12 | 619 |
| 5-saisie-note | Canvas, 1 texture/carte | 59,8 | 16,7 | 2,9 | 31 | 112 | 0 | 12 | 694 |
| 6-dezoom | DOM virtualisé | 59,5 | 16,7 | 2,3 | 12 | 0 | 0 | 1 000 | 1 174 |
| 6-dezoom | Canvas + atlas | 36,9 | 50,0 | 9,0 | 74 | 80 | 32 | 144 | 954 |
| 6-dezoom | Canvas, 1 texture/carte | 36,9 | 50,0 | 9,6 | 56 | 74 | 28 | 144 | 1 202 |
| 7-tempete | DOM virtualisé | 60,0 | 16,8 | 2,0 | 0 | 0 | 0 | 1 000 | 1 174 |
| 7-tempete | Canvas + atlas | 50,9 | 33,4 | 0,7 | 0 | 0 | 0 | 0 | 169 |
| 7-tempete | Canvas, 1 texture/carte | 49,4 | 33,3 | 0,8 | 0 | 0 | 0 | 0 | 169 |
| 8-tempete-region | DOM virtualisé | 60,0 | 16,8 | 1,1 | 14 | 0 | 0 | 1 000 | 1 174 |
| 8-tempete-region | Canvas + atlas | 58,7 | 16,8 | 5,0 | 47 | 262 | 30 | 63 | 722 |
| 8-tempete-region | Canvas, 1 texture/carte | 58,5 | 16,8 | 5,2 | 60 | 250 | 28 | 63 | 722 |

### Par phase, 5 000 cartes (extrapolation)

| Phase | Config | FPS | Frame p95 | JS p95 | Latence p95 | Captures | File max | Cartes montées | Nœuds DOM |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1-vue-ensemble | DOM virtualisé | 60,0 | 16,7 | 3,1 | 0 | 0 | 0 | 2 900 | 3 094 |
| 1-vue-ensemble | Canvas + atlas | 14,8 | 83,4 | 1,8 | 0 | 0 | 0 | 0 | 189 |
| 2-zoom-region | DOM virtualisé | 59,5 | 16,8 | 3,8 | 16 | 0 | 0 | 2 900 | 3 094 |
| 2-zoom-region | Canvas + atlas | 31,8 | 66,7 | 13,4 | 96 | 131 | 109 | 143 | 1 058 |
| 3-pan-region | DOM virtualisé | 60,0 | 16,8 | 2,2 | 13 | 0 | 0 | 132 | 1 525 |
| 3-pan-region | Canvas + atlas | 40,0 | 49,9 | 10,6 | 115 | 1 124 | 87 | 132 | 1 344 |
| 4-zoom-carte | DOM virtualisé | 59,5 | 16,7 | 2,1 | 15 | 0 | 0 | 99 | 1 206 |
| 4-zoom-carte | Canvas + atlas | 42,0 | 50,0 | 10,8 | 54 | 213 | 21 | 90 | 1 159 |
| 5-saisie-note | DOM virtualisé | 60,0 | 16,7 | 1,1 | 15 | 0 | 0 | 12 | 662 |
| 5-saisie-note | Canvas + atlas | 59,8 | 16,8 | 3,8 | 30 | 110 | 0 | 12 | 789 |
| 6-dezoom | DOM virtualisé | 59,5 | 16,7 | 5,7 | 4 | 0 | 0 | 3 080 | 3 154 |
| 6-dezoom | Canvas + atlas | 23,1 | 83,3 | 11,1 | 19 | 70 | 49 | 121 | 789 |
| 7-tempete | DOM virtualisé | 60,0 | 16,8 | 5,6 | 0 | 0 | 0 | 2 900 | 3 154 |
| 7-tempete | Canvas + atlas | 13,2 | 83,4 | 3,9 | 0 | 0 | 0 | 0 | 189 |
| 8-tempete-region | DOM virtualisé | 60,0 | 16,7 | 1,8 | 19 | 0 | 0 | 2 900 | 3 094 |
| 8-tempete-region | Canvas + atlas | 55,3 | 33,3 | 6,3 | 60 | 327 | 41 | 99 | 1 058 |

### Fréquence de mise à jour (1 000 cartes, parcours complet)

| Vitesse | Config | FPS | Frame p95 | JS p50 | JS p95 | Latence p50 | Latence p95 | Captures | File max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ×1 | DOM virtualisé | 59,9 | 16,8 | 0,1 | 1,5 | 10 | 18 | 0 | 0 |
| ×1 | Canvas + atlas | 53,8 | 50,0 | 0,5 | 10,2 | 11 | 131 | 552 | 114 |
| ×10 | DOM virtualisé | 59,8 | 16,8 | 0,1 | 2,3 | 7 | 15 | 0 | 0 |
| ×10 | Canvas + atlas | 50,9 | 50,0 | 0,8 | 10,3 | 17 | 125 | 1 237 | 120 |
| ×100 | DOM virtualisé | 59,8 | 16,8 | 1,2 | 2,6 | 8 | 15 | 0 | 0 |
| ×100 | Canvas + atlas | 44,7 | 50,0 | 3,9 | 12,1 | 23 | 107 | 5 452 | 109 |

Phase de pan seule (là où la fréquence pèse le plus) :

| Vitesse | Config | FPS | Frame p95 | JS p50 | JS p95 | Latence p50 | Latence p95 | Captures | File max |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| ×1 | DOM virtualisé | 60,0 | 16,7 | 0,1 | 0,7 | 8 | 14 | 0 | 0 |
| ×1 | Canvas + atlas | 49,4 | 33,4 | 1,1 | 6,0 | 22 | 32 | 230 | 4 |
| ×10 | DOM virtualisé | 60,0 | 16,8 | 0,1 | 1,2 | 8 | 13 | 0 | 0 |
| ×10 | Canvas + atlas | 44,5 | 33,4 | 2,1 | 8,6 | 24 | 51 | 581 | 6 |
| ×100 | DOM virtualisé | 59,7 | 16,8 | 1,2 | 2,3 | 8 | 14 | 0 | 0 |
| ×100 | Canvas + atlas | 37,5 | 33,4 | 7,7 | 9,6 | 26 | 79 | 2 624 | 23 |

### Budget de recaptures (1 000 cartes, ×100, atlas)

| Budget (captures : ms) | FPS | Frame p95 | JS p95 | Latence p50 | Latence p95 | Captures | ms/capture | File max |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2:2 — parcours | 45,9 | 50,0 | 8,7 | 150 | 802 | 1 722 | 0,84 | 109 |
| 2:2 — pan région | 42,7 | 33,4 | 7,0 | 296 | 802 | 586 | 0,76 | 52 |
| 2:2 — tempête région | 56,1 | 33,3 | 4,8 | 130 | 342 | 504 | 0,70 | 42 |
| 6:3 — parcours | 44,9 | 50,0 | 9,8 | 49 | 228 | 3 667 | 0,64 | 120 |
| 6:3 — pan région | 39,9 | 33,4 | 7,7 | 75 | 228 | 1 423 | 0,58 | 35 |
| 6:3 — tempête région | 53,1 | 33,3 | 5,2 | 35 | 78 | 1 291 | 0,54 | 38 |
| 12:6 — parcours | 44,3 | 50,0 | 12,1 | 24 | 129 | 5 470 | 0,56 | 109 |
| 12:6 — pan région | 37,6 | 33,4 | 9,6 | 27 | 74 | 2 667 | 0,50 | 27 |
| 12:6 — tempête région | 52,6 | 33,4 | 8,0 | 19 | 43 | 1 596 | 0,53 | 34 |
| 32:12 — parcours | 43,0 | 66,6 | 18,8 | 25 | 88 | 6 051 | 0,58 | 109 |
| 32:12 — pan région | 31,5 | 50,0 | 15,5 | 29 | 50 | 2 987 | 0,53 | 11 |
| 32:12 — tempête région | 51,9 | 33,3 | 10,7 | 19 | 33 | 1 727 | 0,53 | 24 |
| 64:16 — parcours | 41,9 | 50,1 | 23,2 | 25 | 108 | 6 040 | 0,59 | 119 |
| 64:16 — pan région | 32,1 | 50,0 | 16,8 | 28 | 41 | 2 955 | 0,55 | 7 |
| 64:16 — tempête région | 48,4 | 33,4 | 10,7 | 20 | 33 | 1 704 | 0,53 | 4 |

### Lecture des chiffres

- **Le DOM ne décroche jamais.** Son temps JS p95 croît avec le nombre de cartes (1,1 ms à
  250, 2,3 ms à 1 000, 5,7 ms à 5 000) parce qu'en vue d'ensemble chaque carte est une tuile
  `<div>` abonnée au store. Il reste loin des 16,7 ms d'une frame. La vitesse des données ne
  le touche presque pas (2,3 → 2,6 ms de ×10 à ×100) : seules les cartes visibles se
  re-rendent, une fois par frame, grâce à l'application des données par lot.
- **Le mode canvas perd surtout pendant les mouvements de caméra** (zoom, pan, dézoom :
  37 à 48 FPS à 1 000 cartes) et presque pas à l'arrêt (saisie : 59 FPS ; tempête au niveau
  intermédiaire : 59 FPS). Le diagnostic par couches (ci-dessous) montre que c'est le
  **remplissage de pixels** en WebGL logiciel, pas la capture.
- **La vue d'ensemble à 5 000 cartes s'effondre en canvas** (15 FPS, alors que le JS ne prend
  que 1,8 ms) : 5 000 instances redessinées à chaque changement de statut, en logiciel. Le DOM
  ne recompose que les tuiles qui changent. Sur un vrai GPU, 10 000 triangles coûtent bien
  moins d'une milliseconde : cette ligne mesure surtout l'absence de GPU.
- **Les captures sont le vrai coût structurel.** 0,8 ms en moyenne (0,7 au niveau
  intermédiaire, 1,0 à 1,3 ms pour un panneau complet). Elles s'amortissent par lot : de
  0,84 ms à 2 captures par frame à 0,53 ms à 32. À 12 captures par frame, le JS du mode canvas
  atteint 9 à 13 ms au p95, contre 1 à 3 ms en DOM pour les mêmes cartes visibles.
- **La latence du canvas est celle de la file.** p50 de 15 à 23 ms (une frame plus le paint),
  mais p95 de 64 à 141 ms : à l'arrivée sur une région, 100 à 120 cartes manquent de texture
  et passent avant les mises à jour. Le DOM affiche dans la frame (p95 ≈ 15 ms).
- **Atlas ou une texture par carte : pas d'écart de FPS mesurable ici** (50,9 contre 50,5 à
  1 000 cartes). L'atlas fait 3 à 5 appels de dessin au lieu d'un par carte visible (jusqu'à
  ~150), un avantage invisible en logiciel mais réel sur GPU. En revanche il consomme deux fois
  plus de mémoire (80 contre 41 Mo à 1 000 cartes), car ses pages de 16 Mo sont allouées en
  entier.
- **Le canvas allège le DOM** : 169 nœuds en vue d'ensemble contre 1 174 (3 094 à 5 000
  cartes), et un tas JS plus petit (26 contre 43 Mo à 5 000 cartes). C'est son seul avantage
  mesuré ici.

### Ce que coûte chaque couche (diagnostic)

Mesures ponctuelles à 1 000 cartes, ×10, avec les interrupteurs de couches du renderer
(`window.__hic.renderer.layers`).

| Situation | FPS | Frame p95 |
|---|---:|---:|
| Vue d'ensemble, tuiles SDF avec mélange (première version) | 54,0 | 33,3 ms |
| Vue d'ensemble, tuiles en aplat opaque sous 1,5 px d'arrondi | 58,5 | 16,8 ms |
| Vue d'ensemble, sans aucune tuile | 60,0 | 16,7 ms |
| Pan à 35 %, première version (tuile dessinée sous chaque texture) | 43,8 | 33,4 ms |
| Pan à 35 %, même chose sans aucune capture | 43,0 | 33,4 ms |
| Pan à 35 %, textures seules (ni régions, ni tuiles, ni sparklines) | 58,9 | 16,7 ms |
| Pan à 35 %, sans tuile sous les textures opaques | 49,6 | 33,4 ms |
| Mode canvas avec redessin systématique à chaque frame (avant le rendu à la demande) | ~31 | 50 ms |

Leçons : supprimer les captures ne changeait rien au pan ; supprimer le surdessin, si. En
WebGL logiciel, comptez les pixels : pas de tuile sous une texture opaque, pas de calcul SDF
à l'intérieur des rectangles, aplat quand l'arrondi est sous le pixel.

## À partir de combien de cartes, et à quelle fréquence ?

**Mesuré : jamais, jusqu'à 5 000 cartes et ×100.** Dans ce mur, le DOM virtualisé avec zoom
sémantique reste meilleur sur toutes les métriques sauf le nombre de nœuds DOM.

Ce qui ferait basculer, d'après la tendance mesurée (à confirmer sur GPU réel) :

- **Nombre d'éléments en vue d'ensemble.** Le JS du DOM croît d'environ 1,1 ms par millier
  de tuiles. Au-delà de ~10 000 éléments visibles en même temps, le DOM ne tiendra plus la
  frame, alors que des tuiles WebGL instanciées sur GPU coûtent une fraction de milliseconde.
  **Mais à ce stade, les tuiles WebGL suffisent ; HTML-in-Canvas n'y ajoute rien**, puisque
  aucune carte n'est en HTML à ce niveau.
- **Fréquence de mise à jour.** Elle pénalise le canvas, pas le DOM. Chaque donnée affichée
  dans le HTML coûte une capture, alors que le DOM met à jour plusieurs centaines de cartes
  visibles pour 2,6 ms à ×100. Plus les données changent vite, plus le DOM l'emporte.
  HTML-in-Canvas n'a de sens que pour du HTML qui change **moins d'une fois par seconde par
  carte visible** (au-delà, le budget de 12 captures par frame ne suit plus 130 cartes
  visibles : 130 / 12 ≈ 11 frames de retard, soit ≈ 180 ms).
- **Effets visuels.** Si le dashboard doit déformer, éclairer, flouter, faire pivoter ou
  fondre des cartes HTML (ce que le DOM fait mal ou pas du tout), HTML-in-Canvas devient le
  seul moyen de garder du vrai HTML. C'est un choix de capacité, pas de performance.

Règle de décision :

| Votre besoin | Choix |
|---|---|
| Cartes de texte mises à jour en continu, zoom et pan | **DOM virtualisé** + zoom sémantique |
| Des milliers d'éléments en vue d'ensemble, sans texte | **WebGL pur** (tuiles instanciées) ; DOM pour le détail |
| Scène WebGL (shaders, 3D, transitions) qui doit contenir des panneaux HTML éditables ou accessibles | **HTML-in-Canvas**, HTML réservé aux panneaux lents ou en cours d'édition |
| Navigateur sans l'API, iframe sandboxé, rendu serveur | **DOM** (repli automatique obligatoire) |

## Ce qui reste en WebGL, ce qui peut être du HTML capturé

Le critère n'est pas « simple ou complexe » mais **fréquence de changement × besoin de mise en
page**. Une capture coûte de 0,5 à 1,3 ms de thread principal (mesuré, plus le paint de l'élément
par Chrome) ; un attribut d'instance WebGL coûte quelques octets.

| Élément | Où | Pourquoi |
|---|---|---|
| Couleur de statut (tuile, bordure à distance) | **WebGL** (attribut d'instance) | change souvent (tempête : 30 % d'un coup), doit rester lisible à 3 % de zoom ; 1 000 tuiles = 1 appel de dessin |
| Sparkline / séries temporelles | **WebGL** par-dessus la texture | un point toutes les 100-500 ms à ×10 : en HTML ce serait une recapture par point. La zone est réservée (vide) dans le HTML, aux mêmes coordonnées dans les deux niveaux |
| Position, zoom, pan, fondus, surbrillance | **WebGL** (uniformes, alpha d'instance) | changent à chaque frame : jamais de recapture pour un mouvement |
| Nom, chiffre clé, icône météo (niveau intermédiaire) | **HTML capturé**, version légère | typographie, emoji, formatage `Intl` ; change à chaque vente mais la version légère coûte 36 % des texels |
| Panneau complet : mini-tableau, dernier avis, `<textarea>`, `<select>`, bouton | **HTML capturé**, prioritaire | mise en page, formulaires, focus, accessibilité : c'est la raison d'être de l'API |
| Libellés de régions | **DOM ordinaire** au-dessus du canvas | 5 éléments en espace écran, taille de police adaptée au zoom : ni capture ni texte WebGL |
| Vue d'ensemble pour robots / sans JS | **HTML SSR** hors canvas | le canvas n'existe pas côté serveur |

Règles pratiques qui en découlent :

1. **Réserver dans le HTML la place de tout ce que WebGL dessine par-dessus**, en positions
   absolues identiques à tous les niveaux de détail ; sinon la superposition dérive.
2. **Ne rien mettre dans le HTML capturé qui bouge tout seul** : pas d'animation CSS, pas de
   curseur clignotant hors focus, pas d'horloge. Chaque changement de rendu déclenche un
   `paint` avec l'élément dans `changedElements`, donc une recapture.
3. **Faire un HTML « léger » pour le niveau intermédiaire**, plus petit en px CSS : la taille de
   la capture (et de la texture) suit la taille CSS de l'élément, pas sa taille à l'écran.
4. **Ne pas monter de HTML au niveau éloigné.** À 3–25 % de zoom, le texte est illisible ;
   des tuiles instanciées suffisent et le DOM du canvas reste vide.

## Hydratation React : solution retenue

1. La page serveur rend **seulement** la vue d'ensemble (HTML sémantique, sans canvas).
2. Le mur est importé par `next/dynamic(..., { ssr: false })` : il est monté **après**
   l'hydratation et n'a donc aucune contrepartie HTML serveur à réconcilier.
3. Dans le mur, le `<canvas>` est rendu par React, puis les cartes sont insérées **dans** le
   canvas avec `createPortal(cartes, canvas)` une fois la référence du canvas connue
   (`useState` + `ref={setCanvas}`).
4. Les cartes restent des composants React ordinaires (abonnements Zustand, Server Actions,
   gestionnaires d'évènements) ; `drawable=""` est un attribut posé à la création.

Pourquoi pas les alternatives :

- **Rendre les cartes en SSR à l'intérieur du canvas** : le contenu dépend de la caméra, du
  niveau de zoom et de l'API (inconnus côté serveur) ; la moindre différence casse
  l'hydratation, et le HTML serveur de 1 000 cartes serait du poids mort.
- **`suppressHydrationWarning`** : masque le symptôme, pas les décalages d'état.
- **`ReactDOM.createRoot` séparé dans le canvas** : deux arbres React, contexte non partagé,
  double ordonnancement ; le portail garde un seul arbre et un seul commit par frame.

Point d'attention : un portail ne change pas l'ordre du DOM. Les cartes du canvas viennent après
le canvas dans l'ordre de tabulation, donc après la barre d'outils : c'est l'ordre attendu.

## Accessibilité

La vue « Voir ce que voit un robot » et la vérification de bout en bout du mur montraient que **les cartes du
canvas sont dans l'arbre d'accessibilité** (articles, tableaux, `textbox`, `combobox`, bouton) au
même titre qu'en mode DOM : c'est l'avantage décisif de HTML-in-Canvas sur un rendu WebGL pur.
Mais **seules les cartes montées existent** : au niveau éloigné, le mode canvas n'expose aucune
carte (le mode DOM expose 1 000 tuiles sans nom, guère plus utile). La vue d'ensemble SSR (régions,
critiques, alertes) reste donc indispensable pour les robots et les lecteurs d'écran.

## Budget de recaptures recommandé

**8 à 12 captures et au plus 6 ms par frame, la carte qui a le focus hors budget.**

- **2 captures / 2 ms** : la file ne se vide jamais pendant un pan (latence p95 802 ms,
  p50 296 ms). Trop bas.
- **6 / 3** : latence p95 228 ms, JS p95 9,8 ms. Acceptable pour un mur rarement manipulé.
- **12 / 6** : latence p95 129 ms sur le parcours, 74 ms pendant le pan, JS p95 12 ms : le
  meilleur compromis mesuré.
- **32 / 12 et 64 / 16** : la latence ne gagne presque plus (88 et 108 ms) mais le JS p95
  dépasse la frame (19 et 23 ms) et le pan chute à 31-32 FPS.

Ajustements :

- **Budget en ms autant qu'en nombre** : le coût d'une capture varie de 0,5 ms (lot,
  niveau intermédiaire) à 1,3 ms (panneau complet en saisie). Le seuil en ms est vérifié avant
  chaque capture : prévoyez un dépassement d'une capture.
- **≈ un tiers de la frame** au maximum (6 ms sur 16,7 ms), car Chrome peint aussi les
  éléments capturés dans son pipeline, hors du temps JS mesuré.
- **Priorités** : focus > rapprochée manquante > rapprochée périmée > intermédiaire
  manquante > intermédiaire périmée, puis la plus ancienne donnée d'abord. Les cartes hors
  écran ne sont jamais capturées : leur dirty flag attend leur retour.
- **Pistes non mesurées** : baisser le budget pendant les mouvements de caméra et le
  remonter à l'arrêt ; capturer d'abord les cartes proches du centre.

## Atlas de textures ou une texture par carte ?

| | Atlas (pages de 2048², emplacements fixes) | Une texture par carte |
|---|---|---|
| Appels de dessin | 1 par page et par passe (3 à 5) | 1 par carte affichée (jusqu'à ~150) |
| FPS mesuré (logiciel) | identique (50,9) | identique (50,5) |
| Mémoire à 1 000 cartes | 80 Mo (pages entières) | 41 Mo (au texel près) |
| API requise | `texElementSubImage2D` (upload à un décalage) | toutes, y compris l'ancienne `texElementImage2D` |
| Précautions | marge de 2 texels entre emplacements ; une classe de taille par niveau | aucune |

Recommandation : **atlas** dès que les textures sont dessinées à chaque frame sur un vrai GPU
(moins d'appels, moins de changements de texture) ; **une texture par carte** si la mémoire
compte ou si seule l'ancienne API est disponible. Les deux sont derrière la même interface
(`TextureStore`), avec éviction LRU à 256 Mo.

## Pièges et écarts entre la documentation et le comportement réel

Toutes les observations ci-dessous ont été faites sur Chromium 158.0.8127.36 (Chrome for
Testing livré avec Playwright 1.63), Linux, WebGL2 via ANGLE + SwiftShader. Les sondes sont
reproductibles avec la page `/lab` et la vérification du mur (`tests/e2e/verify.ts`), retirées
depuis (historique git, commit `da1c01b`).

| # | Ce qu'on attendait | Ce qu'on observe | Conséquence dans le code |
|---|---|---|---|
| 1 | Flag `chrome://flags/#canvas-draw-element` nécessaire | Chromium 158 de Playwright expose l'API **sans flag** ; `--disable-blink-features=CanvasDrawElement` la retire, `--enable-blink-features=CanvasDrawElement` est l'équivalent ligne de commande du flag | Le banc passe `--enable-…` ; la vérification « Chrome sans flag » utilise `--disable-…` |
| 2 | `captureElementImage(el)` donne la taille à allouer | L'`ElementImage` renvoyé n'expose **que `close()`** : ni `width` ni `height` | Taille calculée : `ceil(offsetWidth × canvas.width / canvas.clientWidth)` (`HicSurface.texelSize`) |
| 3 | Capture en px CSS | Capture en **pixels du backing store** : une carte de 200×100 px CSS dans un canvas dont le backing vaut 2× sa taille CSS produit 400×200 texels, **indépendamment du `devicePixelRatio` de la page** (c'est le ratio backing/CSS du canvas qui compte) | Backing = taille CSS × DPR ; textures invalidées si ce ratio change |
| 4 | Erreur explicite si la texture est trop petite | `GL_INVALID_VALUE` (« Offset overflows texture dimensions ») dans la console, **aucune exception**, et **rien n'est copié** : texture noire/transparente | `upload()` lit `gl.getError()` ; `verify()` lit des texels ; repli en mode DOM si vide |
| 5 | Une texture plus grande que la capture est refusée | Acceptée : la capture est copiée à `(x, y)` et le reste est intact | C'est ce qui rend l'**atlas** possible avec `texElementSubImage2D` |
| 6 | Upload possible n'importe quand | Avant le premier paint de l'élément : exception « **No cached paint record for element** ». Après, l'upload marche hors du handler (dans un `setTimeout`) mais copie le **dernier paint enregistré** : un span passé du bleu au vert puis uploadé aussitôt donne encore du bleu ; le paint suivant donne du vert | Upload uniquement dans le handler `paint`, où l'enregistrement est garanti à jour |
| 7 | — | Enfant sans attribut `drawable` : exception « Descendants passed to texElementSubImage2D() must have the 'drawable' attribute » | `drawable` posé par React sur l'`<article>` de chaque carte |
| 8 | `canvasTransform` en pixels du canvas (grille) | En **px CSS** du canvas : `translate(100, 50)` place l'élément à +100/+50 px CSS, que le backing soit 1× ou 2× (vérifié avec un canvas 800×400 affiché en 400×200 et avec DPR 2) | `probeGeometryUnit()` mesure l'unité au démarrage ; l'unité est affichée dans l'info-bulle du badge |
| 9 | La position de mise en page des enfants compte pour le hit testing | Ignorée : un enfant placé en `left: 3000px` a pour rectangle l'origine du canvas tant qu'aucune géométrie n'est fournie | Tous les enfants à `left: 0; top: 0` ; géométrie calculée pour **toutes** les cartes montées, sinon elles interceptent les clics dans le coin haut-gauche |
| 10 | `requestPaint()` déclenche un paint « plus tard » | `requestPaint()` dans un `rAF` déclenche le paint **dans la même frame**, après le rAF ; ordre observé : rAF → paint | Caméra + géométrie en rAF, captures + dessin dans `paint`, pas d'image de retard |
| 11 | `paint` ne se déclenche que sur demande | Se déclenche aussi seul à chaque modification du sous-arbre (texte, style, focus, curseur) avec `changedElements` = éléments touchés ; `updateElementGeometry` **ne** déclenche **pas** de paint | `changedElements` alimente les dirty flags (saisie, focus) en plus du store |
| 12 | Coût négligeable de la géométrie | ≈ 6 µs par appel à `updateElementGeometry` (200 éléments ≈ 1,2 ms) | Géométrie recalculée seulement quand la caméra ou l'ensemble monté change |
| 13 | Anciens noms retirés | `texElementImage2D` absent, mais `getElementTransform` toujours présent à côté de `updateElementGeometry` | Détection par fonctionnalité, nouvelle API préférée |
| 14 | Texture : ligne 0 en bas (convention GL) | Ligne 0 = **haut** de l'élément | Coordonnées de texture non retournées |
| 15 | Le focus d'un champ dans le canvas le rend visible là où il est dessiné | Le défilement automatique vise sa **position de mise en page** dans le canvas, pas sa position dessinée : dans un conteneur défilant, `focus()` a fait défiler de 461 px vers un champ placé à `top: 400px` dans la carte | Conteneur en `overflow: clip` et caméra qui suit le focus (`focusin`) |
| 16 | — | Le « click » qui suit un `pointerdown` capturé (`setPointerCapture`) est envoyé au conteneur, pas à la carte dans le canvas (comme en DOM) | La carte cliquée est retenue au `pointerdown` |

## Limites de cette étude

- **Pas de GPU** : à refaire sur une machine équipée avant de conclure sur les FPS du mode
  canvas. Le banc du mur (`npm run bench`) est dans l'historique git (commit `da1c01b`).
- Une seule version de Chromium (158) ; l'API est expérimentale et évolue (renommages de
  Chrome 155). Le chemin « ancienne API » est codé mais n'a pas pu être exécuté.
- Headless, DPR 1 : à DPR 2, chaque capture et chaque texture coûtent 4 fois plus de texels.
- Le tas JS n'est fiable qu'avec `--enable-precise-memory-info` (sans ce flag, la valeur reste
  figée). La mémoire des textures est une estimation, pas une mesure du pilote.
- La latence exclut la présentation à l'écran (≈ une frame de plus dans les deux modes).
