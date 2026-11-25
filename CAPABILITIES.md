# CAPABILITIES.md — réseau d'eau potable 3D : classique vs HTML-in-Canvas

Démo du dépôt (`/`) : le vrai réseau d'aqueduc de Trois-Rivières (24 137 tronçons,
Données Québec, CC-BY 4.0) vu par un directeur des travaux publics, avec des capteurs, des
secteurs et un bris **simulés**. Les mêmes composants React sont rendus de deux façons :

- **Classique** : noms de secteurs, marquage de l'incident et étiquettes des capteurs en
  marqueurs MapLibre DOM, plats et toujours au premier plan ; la coupe du scénario est dans la
  fiche.
- **HTML-in-Canvas** : les mêmes éléments montés dans le canvas de MapLibre, capturés en
  textures et dessinés par une custom layer (`src/client/hic3d/`) qui partage la profondeur des
  bâtiments : marquages couchés au sol, étiquettes face caméra, coupe verticale sous la chaussée
  pendant le scénario.

La vue souterraine (tubes 3D) est du WebGL2 maison présent **dans les deux modes** ; elle ne
dépend pas de l'API.

Preuves régénérables par `npm run proofs:aqueduc` (`docs/aqueduc/`, `proofs.json`), prises
**sans GPU** (SwiftShader, Chromium 158.0.8127.36, 1440×860).

## Matrice des capacités

| Critère | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Nom de secteur couché au sol, en perspective | Non (étiquette plate) | **Oui** | [sol](docs/aqueduc/sol-hic.png) | Le texte au sol seul n'est pas propre à HTML-in-Canvas (voir plus bas). |
| Masqué par les bâtiments | **Non** | **Oui** | [classique](docs/aqueduc/occlusion-classic.png) · [canvas](docs/aqueduc/occlusion-hic.png) | Même caméra : la tour coupe l'étiquette « 4,5 bar » de P-01 ; en classique, l'étiquette Centre-ville est posée sur un bâtiment (`building: true`). Les parties cachées des marquages au sol restent visibles à 45 % (fantôme). |
| Clic bloqué sur la partie masquée | **Non** | **Oui, avec du code** | `proofs.json` `occlusion_*` | Classique : le clic sur l'étiquette posée sur le bâtiment sélectionne le secteur. Canvas : clic sur une lettre masquée → la carte reçoit le clic (`passThrough: 1`, aucune sélection) ; sur une lettre dégagée → secteur Centre-ville sélectionné. Requêtes d'occlusion WebGL2 : voir « Hit testing avec occlusion ». |
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

**Fantôme à 45 % (`GROUND_GHOST`).** La partie d'un marquage au sol cachée par un
bâtiment n'est pas effacée mais dessinée à 45 % d'opacité, pour que le chiffre d'un secteur reste
lisible derrière un immeuble. Les clics sur la partie cachée restent bloqués. Les étiquettes des
capteurs, elles, sont masquées complètement.

**Hit testing avec occlusion.** Le hit testing de l'API suit `canvasTransform` (matrice
projective 4×4 comprise) mais ignore la profondeur WebGL : sans rien faire, une étiquette cachée
derrière un immeuble reçoit quand même les clics. À chaque déplacement du pointeur, la surface
sous le curseur est trouvée par homographie inverse, puis redessinée sur ce seul pixel (scissor
1×1) dans une requête d'occlusion WebGL2 ; le verdict règle `pointer-events` de la surface. Au
`pointerdown`, sans verdict récent au même endroit, l'évènement est bloqué (échec fermé). Une
surface masquée reste dans l'ordre de tabulation ; quand elle reçoit le focus, la caméra se
recentre et elle est dessinée au travers des bâtiments. Code : `src/client/hic3d/HicHost.tsx`,
`occlusion.ts` et `panelLayer.ts`.

## Mesures, sans GPU (SwiftShader)

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

### Rotation de 90° en 8 s

| Étiquettes | Mode | FPS | Frame p95 | JS / image p95 |
|---:|---|---:|---:|---:|
| 20 | Classique | 12,2 | 100 ms | 0,9 ms |
| 20 | HTML-in-Canvas | 12,3 | 100 ms | 1,6 ms |
| 60 | Classique | 12,0 | 108 ms | 1,1 ms |
| 60 | HTML-in-Canvas | 11,3 | 108 ms | 4,2 ms |
| 120 | Classique | 11,7 | 108 ms | 1,1 ms |
| 120 | HTML-in-Canvas | 11,7 | 108 ms | 4,5 ms |

### Caméra immobile, horloge ×60 (12 s)

| Étiquettes | Mode | FPS | Frame p95 | JS / mise à jour p95 / max | Captures / min | Latence p50 * | p95 * | Échantillons |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 20 | Classique | 53,6 | 17 ms | 3,4 / 5,0 ms | 0 | 112 ms | 1 067 ms | 78 |
| 20 | HTML-in-Canvas | 45,6 | 67 ms | 3,5 / 8,9 ms | 390 | 644 ms | 1 169 ms | 51 |
| 60 | Classique | 53,6 | 17 ms | 3,3 / 6,5 ms | 0 | 79 ms | 1 066 ms | 174 |
| 60 | HTML-in-Canvas | 44,5 | 75 ms | 3,8 / 7,2 ms | 504 | 174 ms | 1 130 ms | 67 |
| 120 | Classique | 53,1 | 17 ms | 4,8 / 7,5 ms | 0 | 103 ms | 1 102 ms | 312 |
| 120 | HTML-in-Canvas | 41,0 | 83 ms | 4,8 / 10,6 ms | 970 | 167 ms | 1 135 ms | 112 |

### Lecture du scénario (5 étapes et fermeture des vannes, 3 s chacune)

| Étiquettes | Mode | FPS | Frame p95 | Captures / min | Latence p50 * | p95 * |
|---:|---|---:|---:|---:|---:|---:|
| 20 | Classique | 32,2 | 83 ms | 0 | 225 ms | 2 158 ms |
| 20 | HTML-in-Canvas | 29,7 | 83 ms | 352 | 443 ms | 1 963 ms |
| 60 | Classique | 33,2 | 83 ms | 0 | 207 ms | 2 037 ms |
| 60 | HTML-in-Canvas | 28,8 | 83 ms | 695 | 588 ms | 2 118 ms |
| 120 | Classique | 31,8 | 83 ms | 0 | 286 ms | 1 726 ms |
| 120 | HTML-in-Canvas | 25,9 | 92 ms | 1 631 | 509 ms | 1 989 ms |

### Vue souterraine (HTML-in-Canvas, 60 étiquettes)

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

## Conclusion

**Ici, l'approche tient ses promesses fonctionnelles.** La 3D est le produit : un nom de secteur appartient à un quartier, une valeur de pression à un
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
