# CAPABILITIES.md — panneaux HTML dans une scène 3D : classique vs HTML-in-Canvas

Deux démos y sont comparées en mode classique et en HTML-in-Canvas : la **livraison 3D**
(`/carte`, ci-dessous) et le **réseau d'eau potable 3D** (`/`,
[section en fin de document](#réseau-deau-potable-3d--classique-vs-html-in-canvas)).

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
| Panneaux inclus dans l'export vidéo | **Non** | **Oui** | [image à 5 s, classique](docs/carte/video-classic-image-5s.png) · [canvas](docs/carte/video-hic-image-5s.png) · [vidéo classique](docs/carte/video-classic.webm) · [vidéo canvas](docs/carte/video-hic.webm) | `canvas.captureStream(30)` + `MediaRecorder`, 10 s, WebM 900×612. Les popups DOM n'existent pas dans le canvas : la vidéo classique n'a que la carte. Depuis, l'export recopie la carte dans un canvas 2D et ajoute dessous un bandeau de crédits (fond de carte, données simulées) ; les fichiers de `docs/carte/` sont antérieurs. |
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

**Implémentation** (`src/client/hic3d/HicHost.tsx`, `src/client/hic3d/occlusion.ts`, `src/client/carte/hic/panelLayer.ts`) :

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

---

## Réseau d'eau potable 3D : classique vs HTML-in-Canvas

Démo par défaut du dépôt (`/`) : le vrai réseau d'aqueduc de Trois-Rivières (24 137 tronçons,
Données Québec, CC-BY 4.0) vu par un directeur des travaux publics, avec des capteurs, des
secteurs et un bris **simulés**. Les mêmes composants React sont rendus de deux façons :

- **Classique** : noms de secteurs, marquage de l'incident et étiquettes des capteurs en
  marqueurs MapLibre DOM, plats et toujours au premier plan ; la coupe du scénario est dans la
  fiche.
- **HTML-in-Canvas** : les mêmes éléments montés dans le canvas de MapLibre et dessinés par la
  custom layer de `/carte` (profondeur partagée avec les bâtiments) : marquages couchés au sol,
  étiquettes face caméra, coupe verticale sous la chaussée pendant le scénario.

La vue souterraine (tubes 3D) est du WebGL2 maison présent **dans les deux modes** ; elle ne
dépend pas de l'API.

Preuves régénérables par `npm run proofs:aqueduc` (`docs/aqueduc/`, `proofs.json`), prises
**sans GPU** (SwiftShader, Chromium 158.0.8127.36, 1440×860).

### Matrice des capacités

| Critère | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Nom de secteur couché au sol, en perspective | Non (étiquette plate) | **Oui** | [sol](docs/aqueduc/sol-hic.png) | Le texte au sol seul n'est pas propre à HTML-in-Canvas (voir plus bas). |
| Masqué par les bâtiments | **Non** | **Oui** | [classique](docs/aqueduc/occlusion-classic.png) · [canvas](docs/aqueduc/occlusion-hic.png) | Même caméra : la tour coupe l'étiquette « 4,5 bar » de P-01 ; en classique, l'étiquette Centre-ville est posée sur un bâtiment (`building: true`). Sur `/`, les parties cachées des marquages au sol restent visibles à 45 % (fantôme). |
| Clic bloqué sur la partie masquée | **Non** | **Oui, avec du code** | `proofs.json` `occlusion_*` | Classique : le clic sur l'étiquette posée sur le bâtiment sélectionne le secteur. Canvas : clic sur une lettre masquée → la carte reçoit le clic (`passThrough: 1`, aucune sélection) ; sur une lettre dégagée → secteur Centre-ville sélectionné. Requêtes d'occlusion WebGL2, comme sur `/carte`. |
| Focus clavier, Entrée ouvre la fiche | Oui | **Oui, dans la scène** | [focus](docs/aqueduc/focus-hic.png) · `focus_*` | P-01 atteint en 9 Tab (classique) et 12 Tab (canvas, élément dans le canvas). |
| Lecteur d'écran | Oui | **Oui** | `aria_classic`, `aria_hic` | Mêmes noms accessibles, avec la mention de simulation : « Capteur de pression P-01 (simulation) : 4,5 bar, normal », « Secteur Centre-ville (simulé) : 2 417 adresses desservies ». |
| Coupe sous la chaussée, vannes en vrais boutons | Dans la fiche, à plat | **Dans la scène** | [coupe](docs/aqueduc/coupe-hic.png) · `coupe_hic` | Même composant. Étape « Isolation » : conduite 13C1949, bris, pressions, boutons « V-1878 · à fermer » et « V-3573 · à fermer ». |
| Inscriptions dans l'export vidéo | **Non** | **Oui** | [image à 5 s, classique](docs/aqueduc/video-classic-image-5s.png) · [canvas](docs/aqueduc/video-hic-image-5s.png) | WebM VP9 1440×870, ~10 s : l'image de la carte (1440×808) et, dessous, un bandeau de crédits (conduites, fond de carte, « simulation »). Les marqueurs DOM n'existent pas dans le canvas : la vidéo classique n'a que la carte et le bandeau. |
| Étiquettes parmi les tubes souterrains | Par-dessus tout | **Dans la scène** (même tampon de profondeur) | [souterrain](docs/aqueduc/souterrain-hic.png) | Tubes : 12 568 instances (maîtresses et centre-ville), diamètres exagérés ×12, indiqué à l'écran. |
| Sans l'API | Oui | **Oui, par repli** | [sans API](docs/aqueduc/sans-api.png) · `sans_api` | Chrome avec `--disable-blink-features=CanvasDrawElement` : mode classique, bandeau, bouton « Voir la version HTML-in-Canvas en vidéo ». |

**Le texte au sol n'est pas l'apport de HTML-in-Canvas.** MapLibre pose déjà du texte à plat sur
le sol avec une couche de symboles (`text-pitch-alignment: "map"`), et la première version du mode
classique de cette démo plaçait ainsi les noms de secteurs. Depuis, le mode classique affiche les
mêmes composants React que la scène, en étiquettes plates, pour que la comparaison porte sur le
même contenu. La différence réelle est que la scène contient du **HTML** : interactif,
focalisable, accessible, et masqué par les bâtiments, clics compris.

**Fantôme à 45 % (`GROUND_GHOST`).** Sur `/`, la partie d'un marquage au sol cachée par un
bâtiment n'est pas effacée mais dessinée à 45 % d'opacité, pour que le chiffre d'un secteur reste
lisible derrière un immeuble. Les clics sur la partie cachée restent bloqués. Les étiquettes des
capteurs, elles, sont masquées complètement ; `/carte` n'est pas concerné.

### Mesures, sans GPU (SwiftShader)

**Machine sans GPU** : WebGL2 = ANGLE + SwiftShader (logiciel), Chromium 158.0.8127.36 headless,
Intel Xeon 2,1 GHz × 4, vue 1280×800, DPR 1, 2 répétitions, environ 12 min
(`bench/results/aqueduc.csv`, `aqueduc-meta.json`, section « Réseau d'eau » de `/bench`). Valeurs
= moyennes des deux répétitions.

Le banc force 20, 60 ou 120 étiquettes : les capteurs réels de la zone, puis des points de
mesure supplémentaires **simulés**, sans le filtre de pertinence ni le plafond de 8 de l'usage
normal. La caméra de départ n'en montre qu'une partie :

| Étiquettes (nominal) | 20 | 60 | 120 |
|---|---:|---:|---:|
| À l'écran, classique | 11 | 34 | 36 |
| À l'écran, HTML-in-Canvas | 12 | 37 | 38 |

(mesuré une fois, dans une passe séparée ; ces nombres varient de quelques étiquettes d'un
chargement à l'autre)

#### Rotation de 90° en 8 s

| Étiquettes | Mode | FPS | Frame p95 | JS / image p95 |
|---:|---|---:|---:|---:|
| 20 | Classique | 12,2 | 100 ms | 0,9 ms |
| 20 | HTML-in-Canvas | 12,3 | 100 ms | 1,6 ms |
| 60 | Classique | 12,0 | 108 ms | 1,1 ms |
| 60 | HTML-in-Canvas | 11,3 | 108 ms | 4,2 ms |
| 120 | Classique | 11,7 | 108 ms | 1,1 ms |
| 120 | HTML-in-Canvas | 11,7 | 108 ms | 4,5 ms |

#### Caméra immobile, horloge ×60 (12 s)

| Étiquettes | Mode | FPS | Frame p95 | JS / mise à jour p95 / max | Captures / min | Latence p50 * | p95 * | Échantillons |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 20 | Classique | 53,6 | 17 ms | 3,4 / 5,0 ms | 0 | 112 ms | 1 067 ms | 78 |
| 20 | HTML-in-Canvas | 45,6 | 67 ms | 3,5 / 8,9 ms | 390 | 644 ms | 1 169 ms | 51 |
| 60 | Classique | 53,6 | 17 ms | 3,3 / 6,5 ms | 0 | 79 ms | 1 066 ms | 174 |
| 60 | HTML-in-Canvas | 44,5 | 75 ms | 3,8 / 7,2 ms | 504 | 174 ms | 1 130 ms | 67 |
| 120 | Classique | 53,1 | 17 ms | 4,8 / 7,5 ms | 0 | 103 ms | 1 102 ms | 312 |
| 120 | HTML-in-Canvas | 41,0 | 83 ms | 4,8 / 10,6 ms | 970 | 167 ms | 1 135 ms | 112 |

#### Lecture du scénario (5 étapes et fermeture des vannes, 3 s chacune)

| Étiquettes | Mode | FPS | Frame p95 | Captures / min | Latence p50 * | p95 * |
|---:|---|---:|---:|---:|---:|---:|
| 20 | Classique | 32,2 | 83 ms | 0 | 225 ms | 2 158 ms |
| 20 | HTML-in-Canvas | 29,7 | 83 ms | 352 | 443 ms | 1 963 ms |
| 60 | Classique | 33,2 | 83 ms | 0 | 207 ms | 2 037 ms |
| 60 | HTML-in-Canvas | 28,8 | 83 ms | 695 | 588 ms | 2 118 ms |
| 120 | Classique | 31,8 | 83 ms | 0 | 286 ms | 1 726 ms |
| 120 | HTML-in-Canvas | 25,9 | 92 ms | 1 631 | 509 ms | 1 989 ms |

#### Vue souterraine (HTML-in-Canvas, 60 étiquettes)

| Tubes | Instances | FPS rotation | Frame p95 rotation | FPS immobile | Frame p95 immobile |
|---|---:|---:|---:|---:|---:|
| aucun (vue normale) | 0 | 11,3 | 108 ms | 44,5 | 75 ms |
| maîtresses et centre-ville | 12 568 | 10,4 | 117 ms | 44,0 | 83 ms |
| tout le réseau | 41 823 | 7,2 | 167 ms | 28,8 | 142 ms |

Requêtes d'occlusion (HTML-in-Canvas, survol de 10 étiquettes visibles, 5 seulement à
20 étiquettes, caméra immobile) : 88 à 98 ms en moyenne entre survol et verdict, 98 ms avec les
tubes des maîtresses, 143 ms avec tout le réseau, soit une à deux images de cette machine.

\* **Latence lecture → pixel** : de la réception SSE d'une lecture à l'image qui l'affiche
(classique : image qui suit la mise à jour du marqueur ; HTML-in-Canvas : dessin qui suit
l'upload de la texture), étiquettes à l'écran seulement, hors première capture. Moyenne
**pondérée par le nombre d'échantillons** des répétitions qui en ont. Trois réserves :

- **La cadence de 2 s fixe le p95.** Les étiquettes se mettent à jour au plus toutes les 2 s dans
  les deux modes (`useThrottled`) : le p95 (≈ 1,1 s immobile, ≈ 2 s pendant le scénario) mesure
  surtout cette attente, pas le pipeline.
- **Regroupement en HTML-in-Canvas.** Une capture compte pour un échantillon ; une lecture
  remplacée avant sa capture n'est pas comptée. D'où moins d'échantillons qu'en classique pour
  autant d'étiquettes à l'écran (112 contre 312 à 120 étiquettes), et des chiffres un peu
  optimistes pour le mode canvas.
- **Petits échantillons, forte variance.** Le p50 de 644 ms à 20 étiquettes (canvas, immobile)
  pondère deux répétitions très différentes (1 113 ms et 258 ms). Pendant la rotation (horloge
  ×1), il n'y a presque aucun échantillon (de 0 à 15) : ces latences ne sont pas reprises ici.

**Lecture.**

- **Rotation : pas de différence de FPS.** Sans GPU, le rendu 3D de la carte plafonne les deux
  modes à 11-12 images/s. Le JS par image est 2 à 4 fois plus haut en canvas (placement et
  géométrie de chaque surface) mais reste sous 5 ms.
- **Au repos, le canvas perd des images, et de plus en plus avec les étiquettes.** 45,6 → 44,5
  → 41,0 images/s pour 20, 60 et 120 étiquettes, contre ≈ 53 en classique quel que soit le
  nombre ; frame p95 de 67 à 83 ms contre 17 ms. Les captures (390 à 970 par minute, horloge ×60)
  et les redessins qu'elles déclenchent coûtent cher en WebGL logiciel. C'est le point faible
  mesuré de cette démo.
- **Scénario : 2,5 à 6 images/s de moins en canvas**, l'écart grandit avec les étiquettes
  (jusqu'à 1 631 captures par minute à 120).
- **JS par mise à jour de données** (message du flux, rendu des étiquettes, captures) : p95 de
  3,3 à 4,8 ms dans les deux modes, maximum un peu plus haut en canvas (jusqu'à 10,6 ms contre
  7,5 ms).
- **Latence p50 plus haute en canvas** : 167-174 ms contre 79-103 ms au repos à 60 et 120
  étiquettes, 443-588 ms contre 207-286 ms pendant le scénario. Le p95, dominé par la cadence de 2 s,
  est équivalent.
- **Tubes** : les maîtresses (12 568 instances) coûtent peu ; tout le réseau (41 823) fait
  tomber la rotation à 7 images/s et le repos à 29 images/s : d'où le réglage par défaut.

À refaire sur une machine avec GPU (`npm run bench:aqueduc` ; la méta indique `"gpu"`) avant de
conclure sur les FPS : ici, tout redessin est payé par le CPU.

### Conclusion

**Ici, l'approche tient ses promesses fonctionnelles.** Contrairement à la carte de livraison,
la 3D est le produit : un nom de secteur appartient à un quartier, une valeur de pression à un
point du réseau, une vanne à une rue. HTML-in-Canvas permet de les inscrire dans la scène tout en
gardant du vrai HTML : boutons focalisables, noms accessibles avec leur mention de simulation,
clics bloqués derrière les immeubles, et un scénario de bris dont la vidéo exportée contient les
inscriptions. Le mode classique montre la même information, mais par-dessus la ville, sans
profondeur, et rien de tout cela n'apparaît dans la vidéo.

**Le coût est réel et mesurable**, même avec la règle de huit étiquettes au plus en usage normal :
des images perdues au repos qui augmentent avec le nombre d'étiquettes, une latence d'affichage
(p50) 1,6 à 2,8 fois plus haute (5,7 fois à 20 étiquettes au repos, sur un petit échantillon), un
délai de survol de une à deux images pour le hit testing avec occlusion, et une occlusion adoucie (fantôme à 45 %) pour garder les chiffres lisibles. Le mode
classique reste indispensable : l'API est expérimentale (flag ou Origin Trial) et chaque visiteur
sans elle y bascule.

Pour un outil de supervision de réseau, le bon usage est celui de la démo : peu d'éléments dans la
scène, choisis selon la couche active et l'état des capteurs ; le reste dans la fiche et la frise,
en DOM ordinaire.
