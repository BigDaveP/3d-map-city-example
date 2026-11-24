# CAPABILITIES.md — panneaux HTML dans une scène 3D : classique vs HTML-in-Canvas

Seconde démo du dépôt (`/carte`) : une carte opérationnelle 3D (MapLibre GL JS 6, bâtiments
extrudés OpenFreeMap) de 30 restaurants fictifs et 40 livreurs simulés à Montréal et Québec.
Chaque restaurant a un panneau HTML (statut, commandes en attente, préparation moyenne,
interrupteur « Mettre en pause les commandes en ligne », note d'équipe, bouton « Envoyer un
livreur ») ; chaque livreur un petit panneau (commande, destination, arrivée estimée,
« Réassigner »).

Le premier banc (`RULES.md`) a montré que HTML-in-Canvas n'accélère pas un tableau de bord de
texte. Cette démo teste l'autre hypothèse : **mettre de vrais panneaux HTML dans une scène 3D**,
ce que le DOM superposé ne sait pas faire.

- **Classique** : `Marker` et `Popup` MapLibre en DOM superposé.
- **HTML-in-Canvas** : les mêmes composants React, montés dans le canvas de MapLibre (option A),
  capturés en textures et dessinés par une custom layer qui partage la profondeur des bâtiments.

Toutes les preuves sont régénérables : `npm run proofs:carte` (captures, vidéos,
`docs/carte/proofs.json`). **Mesures et captures prises sans GPU** (WebGL logiciel SwiftShader,
Chromium 158 headless, 4 vCPU) : voir « Mesures secondaires ».

## Verdict

HTML-in-Canvas fait réellement ce que le DOM ne peut pas faire : panneaux en perspective,
masqués par les bâtiments, avec transitions shader, et présents dans un export vidéo, tout en
restant de vrais formulaires accessibles au clavier et aux lecteurs d'écran. Le prix : environ
840 lignes de code WebGL et de géométrie propres à ce mode (contre ~110 pour les popups), un
hit testing qui **ignore l'occlusion** et qu'il faut compléter soi-même, la perte de la
sélection de texte, un temps JS par image 10 à 30 fois plus élevé et une latence de mise à jour
deux fois plus haute à 30-60 panneaux. Voir la conclusion.

## Matrice des capacités

| Critère | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Panneau en perspective avec la caméra | **Non** | **Oui** | [classique](docs/carte/perspective-classic.png) · [canvas](docs/carte/perspective-hic.png) · [façade](docs/carte/facade-hic.png) | Les popups restent plates et parallèles à l'écran. En canvas : face caméra (lacet et tangage de la caméra) ou plaqués sur une façade (orientation fixe, retournés quand on passe derrière pour ne jamais afficher de texte en miroir). |
| Masqué par un bâtiment placé devant | **Non** | **Oui** | [classique](docs/carte/occlusion-classic.png) · [canvas](docs/carte/occlusion-hic.png) | Même caméra, panneau derrière la tour de la Place Ville-Marie : la popup est dessinée par-dessus la tour ; en canvas, seule une bande du panneau dépasse. Custom layer en `renderingMode: "3d"` (test de profondeur contre les `fill-extrusion`). Les panneaux se masquent aussi entre eux. |
| Clic bloqué quand le panneau est masqué | **Non** | **Oui, avec du code** | [`proofs.json`](docs/carte/proofs.json) `clicMasque_*` | Clic au centre de la note masquée : en classique, le focus va dans la note (`textarea:R03`) ; en canvas, le clic atteint la carte (`canvas`). **L'API seule ne le fait pas** : `elementFromPoint` renvoie la note cachée dans les deux modes (voir « Hit testing avec occlusion »). |
| Saisie et focus clavier dans un panneau incliné | **Oui** (panneau plat) | **Oui** | [focus + Tab](docs/carte/focus-tab-hic.png) · [rayons X](docs/carte/focus-xray-hic.png) | Clic, saisie (« Saisie dans un panneau incliné »), puis Tab : bouton du panneau → panneau suivant. Un panneau masqué qui reçoit le focus est recentré et dessiné au travers des bâtiments. La note est enregistrée en base par une Server Action depuis l'intérieur du canvas. |
| Lecteur d'écran (arbre d'accessibilité) | **Oui** | **Oui** | `proofs.json` `aria_classic`, `aria_hic` | Instantané ARIA identique : `region`, `switch` « Mettre en pause les commandes en ligne », `textbox` « Note pour l'équipe… », boutons. Seuls les panneaux **ouverts** existent dans le DOM ; la liste SSR couvre les 30 restaurants sans JavaScript. |
| Transition shader sur un panneau interactif | **Non** | **Oui** | [dissolution](docs/carte/transition-dissolve-hic.png) · [balayage](docs/carte/transition-sweep-hic.png) | Le DOM ne fait que des transitions CSS (opacité, transformation). En canvas : dissolution par cellules ou balayage. Clic dans la note à 16 % de la transition : focus obtenu (`transitionInteractive`), car l'élément et sa géométrie existent dès l'ouverture. |
| Panneaux inclus dans l'export vidéo | **Non** | **Oui** | [image à 5 s, classique](docs/carte/video-classic-image-5s.png) · [canvas](docs/carte/video-hic-image-5s.png) · [vidéo classique](docs/carte/video-classic.webm) · [vidéo canvas](docs/carte/video-hic.webm) | `canvas.captureStream(30)` + `MediaRecorder`, 10 s, WebM 900×612. Les popups DOM n'existent pas dans le canvas : la vidéo classique n'a que la carte. |
| Sélection et copier-coller du texte | **Oui** | **Partiel** | [classique](docs/carte/selection-classic.png) · [canvas](docs/carte/selection-hic.png) · `selection_*` | Triple-clic sur le nom du restaurant : sélection « Brasserie Corvelac » en classique, **sélection vide** en canvas (presse-papiers inchangé). Dans un champ (`textarea`), Ctrl+A puis Ctrl+C fonctionne dans les deux modes. |
| Fonctionne sans l'API (repli) | **Oui** | **Oui, par repli** | [repli](docs/carte/repli-sans-api.png) · `repli` | Chrome lancé avec `--disable-blink-features=CanvasDrawElement` : bascule automatique en mode classique avec la raison affichée. Mêmes garde-fous que le mur : texture vide après upload, aucun `paint` en 2,5 s, échec d'upload. |
| Brouillard / atténuation avec la distance | **Non** | **Oui** | [perspective](docs/carte/perspective-hic.png) | Mélange vers la couleur du ciel selon la profondeur (w de clip) dans le shader. |
| Ombre du panneau au sol | **Non** | **Oui** | [perspective](docs/carte/perspective-hic.png) | Projection oblique du panneau sur le sol, masquée par sa propre transparence. |

## Hit testing avec occlusion

**Constat.** Le hit testing de HTML-in-Canvas suit fidèlement `canvasTransform`, y compris une
matrice **projective** 4×4 : un panneau incliné reçoit les clics exactement là où il est
dessiné. Mais il ignore tout de ce que WebGL dessine par-dessus : sur la sonde,
`elementFromPoint` au centre d'un panneau entièrement caché par une tour renvoie le panneau. Sans
rien faire, on peut taper dans une note invisible.

**Solutions examinées.**

| Approche | Verdict |
|---|---|
| `inert` ou `pointer-events: none` sur les panneaux masqués | Nécessaire mais pas suffisant : il faut savoir **quand** et **où** le panneau est masqué, et un panneau est souvent masqué en partie seulement. |
| Lire le buffer de profondeur | Impossible : WebGL ne permet pas de lire la profondeur du framebuffer par défaut, où MapLibre dessine. Il faudrait que MapLibre rende dans un framebuffer à nous. |
| Lancer de rayon sur la géométrie des bâtiments (CPU) | Possible (empreintes et `render_height` des tuiles), synchrone, mais il faut reconstruire les polygones découpés par tuiles et rester cohérent avec ce que MapLibre affiche. Non retenu. |
| **Requêtes d'occlusion WebGL2** | **Retenu.** Le GPU répond exactement à la question « ce pixel du panneau passe-t-il le test de profondeur ? », avec la profondeur réellement dessinée. |

**Implémentation** (`src/client/carte/HicPanels.tsx`, `hic/panelLayer.ts`) :

1. À chaque `pointermove`, on cherche le panneau sous le curseur par l'**homographie inverse**
   de sa matrice (le plus proche de la caméra en cas de chevauchement).
2. À la fin de la custom layer, on redessine ce seul panneau avec un `scissor` de **1×1 pixel**
   sous le curseur, sans écrire ni couleur ni profondeur, dans une requête
   `ANY_SAMPLES_PASSED`.
3. Le résultat (disponible une image plus tard au plus tôt) règle `pointer-events` du panneau :
   `none` s'il est masqué à cet endroit, le clic tombe alors sur la carte.
4. Le verdict reste valable tant que la caméra n'a pas bougé (et 400 ms pour les panneaux de
   livreurs, qui se déplacent seuls). Au `pointerdown`, sans verdict valable au même endroit,
   l'évènement est **bloqué** (échec fermé) et une requête est lancée : sur écran tactile, le
   premier tapotement sur un panneau peut donc être perdu.
5. En plus, chaque panneau a chaque image une requête d'occlusion sur sa surface entière
   (visible ou non), utilisée pour le focus.

**Coût mesuré.** Délai survol → verdict : 85 à 153 ms en WebGL logiciel (une à deux images de
cette machine) ; ~0,1 ms de JS par requête ; côté GPU, un quad d'un pixel. Une requête au plus
en vol à la fois. Sur un vrai GPU, le délai devrait tomber à une ou deux images (17-33 ms) —
non mesuré ici.

**Focus clavier : choix et justification.** Les panneaux masqués **restent dans l'ordre de
tabulation** : les retirer (`inert`) les retirerait aussi de l'arbre d'accessibilité, et un
lecteur d'écran n'a que faire de la géométrie 3D. Quand un panneau qui n'est pas entièrement
visible reçoit le focus, la caméra se recentre sur lui et il est dessiné **au travers des
bâtiments** (sans test de profondeur, liseré bleu) tant qu'il garde le focus. On montre donc
toujours ce qu'on édite, sans déplacer la caméra de façon imprévisible.

## Écarts entre la documentation et le comportement observé

| # | Attendu | Observé | Conséquence |
|---|---|---|---|
| 1 | Hit testing « là où l'élément est dessiné » | Suit `canvasTransform` mais **ignore la profondeur WebGL** | Requêtes d'occlusion (ci-dessus) |
| 2 | `canvasTransform` affine 2D | Une matrice **projective 4×4** est acceptée et le hit testing suit la perspective (rectangle englobant compris) | Panneaux inclinés cliquables sans approximation |
| 3 | Sélection de texte comme dans le DOM | Triple-clic dans un élément `drawable` : sélection vide ; la surbrillance ne serait de toute façon visible qu'après recapture | Pas de copier-coller du texte statique ; les champs de formulaire fonctionnent |
| 4 | — | Le canvas d'une bibliothèque (MapLibre) peut porter `content="drawable"` sans rien casser, mais elle met l'état GL en cache : l'upload dans `paint` doit **restaurer** texture liée, unité active et framebuffer | Sauvegarde / restauration autour de chaque lot d'uploads |
| 5 | (MapLibre) `modelViewProjectionMatrix` pour une custom layer | Pour des coordonnées Mercator 0..1, il faut `defaultProjectionData.mainMatrix` ; l'autre fait s'effondrer la géométrie en un point | Documenté dans le README |
| 6 | (Next 16 / Turbopack) — | Le worker de MapLibre 6, chargé par `new URL(..., import.meta.url)`, relançait le rechargement à chaud en boucle | Worker servi tel quel par `/maplibre/[file]` |
| 7 | — | Un plan de façade vu de dos affiche le texte en miroir | Plan retourné de 180° quand la caméra est derrière |

## Mesures secondaires

**Machine : sans GPU.** WebGL2 = ANGLE + SwiftShader (logiciel), Chromium 158.0.8127.36 headless,
Intel Xeon 2,1 GHz × 4, vue 1000×650, DPR 1, 2 répétitions (`bench/results/carte.csv`,
`carte-meta.json`). Toutes les mesures ci-dessous ont été prises **sans GPU**. Le rendu 3D de
MapLibre seul plafonne la machine à ~11-13 images/s dans les deux modes : les FPS ne
départagent rien ici. Les temps JS, les captures et la latence ne dépendent pas du GPU.

« 60 panneaux » = 30 restaurants + 30 livreurs, répartis sur les deux villes (les panneaux de
l'autre ville restent montés et capturés, mais hors champ). Latence statut → pixel : de la
réception d'un changement (polling toutes les 5 s) à l'image qui l'affiche, hors première
ouverture d'un panneau ; elle inclut le délai de 2 s maximum par panneau imposé au HTML.

#### Rotation de 90° en 8 s

| Panneaux | Mode | FPS | Frame p95 | JS p95 / frame | Captures / min | ms / capture | Latence statut → pixel p50 | p95 | Échantillons | Nœuds DOM |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | Classique (DOM) | 11,4 | 117 ms | 0,2 ms | 0 | — | 173 ms | 173 ms | 4 | 536 |
| 10 | HTML-in-Canvas | 11,3 | 117 ms | 2,6 ms | 44 | 0,50 | 140 ms | 185 ms | 5 | 482 |
| 30 | Classique (DOM) | 11,5 | 108 ms | 0,2 ms | 0 | — | 130 ms | 180 ms | 22 | 983 |
| 30 | HTML-in-Canvas | 11,3 | 117 ms | 3,6 ms | 164 | 0,39 | 274 ms | 374 ms | 12 | 841 |
| 60 | Classique (DOM) | 10,8 | 125 ms | 0,2 ms | 0 | — | 197 ms | 197 ms | 26 | 1 457 |
| 60 | HTML-in-Canvas | 10,7 | 125 ms | 5,9 ms | 324 | 0,45 | 269 ms | 456 ms | 27 | 1 202 |

#### Caméra immobile, données en direct (12 s)

| Panneaux | Mode | FPS | Frame p95 | JS p95 / frame | Captures / min | ms / capture | Latence statut → pixel p50 | p95 | Échantillons | Nœuds DOM |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | Classique (DOM) | 13,3 | 92 ms | 0,2 ms | 0 | — | 164 ms | 175 ms | 10 | 536 |
| 10 | HTML-in-Canvas | 12,5 | 100 ms | 1,9 ms | 85 | 0,39 | 170 ms | 211 ms | 16 | 482 |
| 30 | Classique (DOM) | 13,2 | 100 ms | 0,2 ms | 0 | — | 175 ms | 175 ms | 26 | 983 |
| 30 | HTML-in-Canvas | 12,2 | 100 ms | 3,7 ms | 311 | 0,36 | 296 ms | 422 ms | 48 | 841 |
| 60 | Classique (DOM) | 12,6 | 100 ms | 0,2 ms | 0 | — | 164 ms | 181 ms | 38 | 1 457 |
| 60 | HTML-in-Canvas | 11,3 | 108 ms | 5,5 ms | 293 | 0,41 | 319 ms | 451 ms | 38 | 1 202 |

| Panneaux | Requêtes d'occlusion mesurées | Délai moyen survol → verdict |
|---:|---:|---:|
| 10 | 2 | 85 ms |
| 30 | 4 | 91 ms |
| 60 | 9 | 90 ms |


**Lecture.**

- **FPS identiques** (écart ≤ 1 image/s) : sans GPU, le coût de la carte 3D domine tout. Le
  surcoût GPU des panneaux texturés n'est pas mesurable ici.
- **Temps JS par image : ×10 à ×30.** 0,2 ms en classique quel que soit le nombre de popups ;
  1,9 à 5,9 ms en canvas, croissant avec le nombre de panneaux (placement, homographie et
  `updateElementGeometry` de chaque panneau à chaque image, plus les uploads). À 60 panneaux on
  consomme un tiers d'une image à 60 Hz.
- **Captures : 44 à 324 par minute**, à 0,36-0,50 ms chacune. Elles suivent les changements
  réels de données, limités à un toutes les 2 s par panneau (`useThrottled`) ; la rotation de
  caméra n'en déclenche aucune.
- **Latence statut → pixel** : équivalente à 10 panneaux (p50 140-170 ms contre 164-173 ms),
  puis **environ deux fois plus haute** à 30 et 60 panneaux (p50 270-320 ms, p95 374-456 ms,
  contre 130-197 ms) : un même polling change beaucoup de panneaux, et les captures se
  répartissent sur plusieurs évènements `paint` (8 par évènement au maximum). Un défaut corrigé
  en cours de route (panneaux repoussés par le budget puis oubliés) donnait un p95 de 2,7 à
  5,2 s.
- **DOM** : légèrement plus petit en canvas (pas de marqueurs DOM), sans conséquence ici.
- **Requêtes d'occlusion** : 85-91 ms en moyenne entre survol et verdict (petits échantillons :
  2 à 9 requêtes par configuration).

À refaire sur une machine avec GPU (`npm run bench:carte`, la méta indique `"gpu": true`) avant
de conclure sur les FPS.

## Conclusion

**Pour ce produit — un tableau de bord de livraison — l'approche ne vaut pas sa complexité.**
Un répartiteur veut lire un statut, taper une note et envoyer un livreur. Des popups plates,
toujours lisibles, toujours cliquables et sélectionnables, font mieux ce travail. Elles coûtent
dix fois moins de code et de temps JS, et fonctionnent dans tous les navigateurs. Qu'un panneau
soit masqué par une tour est un défaut pour cet utilisateur, pas une qualité. Et comme l'API
est expérimentale (Chrome, Origin Trial), le mode classique doit de toute façon être maintenu
comme repli : on paie deux implémentations.

**Elle vaut la complexité quand la 3D est le produit et que l'interface doit vivre dans le
monde :**

- jumeaux numériques et supervision de bâtiments, d'usines ou de réseaux, où un panneau
  appartient à un équipement, doit être masqué par la structure et rester un vrai formulaire ;
- salles de contrôle et murs d'écrans à caméra animée, où l'esthétique (perspective,
  transitions, brouillard) fait partie de la lisibilité ;
- **contenus enregistrés** : rejouer ou diffuser une séquence d'opérations avec ses panneaux
  (export vidéo), ce qu'aucune superposition DOM ne permet sans recomposer l'image ;
- jeux, simulations et formation, où des formulaires accessibles doivent exister dans la scène.

Dans ces cas, prévoir dès le départ : le hit testing avec occlusion (requêtes d'occlusion ou
lancer de rayon), la politique de focus pour les panneaux masqués, l'absence de sélection de
texte, un budget et un throttling de captures, et le repli DOM.
