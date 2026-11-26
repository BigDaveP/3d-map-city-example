# CAPABILITIES.md : HTML-in-Canvas dans un outil de gestion du territoire

Ce que l'API HTML-in-Canvas permet dans un vrai contexte de gestion municipale, environnement par
environnement, avec les preuves. Démo non officielle : données ouvertes réelles de
Trois-Rivières (conduites, zones de stationnement de nuit, météo d'ECCC) et données simulées,
marquées comme telles (voir le [README](README.md#données-et-licences)).

L'outil affiche les mêmes composants React de deux façons, sur la même carte MapLibre :

- **Classique** : les inscriptions (secteurs, capteurs, zones) sont des marqueurs DOM plats,
  toujours au premier plan, absents du canvas.
- **HTML-in-Canvas** : les mêmes éléments sont montés dans le canvas de la carte, capturés en
  textures et dessinés par une custom layer (`src/client/hic3d/`) qui partage la profondeur des
  bâtiments. Ils restent du vrai HTML : boutons, focus clavier, noms accessibles.

Preuves régénérables par `npm run proofs:territoire` : [`docs/territoire/`](docs/territoire/)
pour l'outil, [`docs/aqueduc/`](docs/aqueduc/) pour le détail de l'Aqueduc, chacun avec son
`proofs.json`. Prises le 25 novembre 2026 **sans GPU** (WebGL logiciel SwiftShader, Chromium
158.0.8127.36, 1440 × 860, DPR 1), horloge épinglée sur la journée scénarisée.

## En bref

- **Inscrire l'information là où elle se trouve.** Un état d'interdiction appartient à une zone,
  une pression à un point du réseau, une vanne à une rue : les marquages sont posés au sol ou dans
  la rue, en perspective, et pas par-dessus la ville.
- **Garder du vrai HTML dans la 3D.** Un marquage de zone est un bouton : on le focalise au
  clavier, un lecteur d'écran lit son nom avec la mention « simulé », un clic ouvre la fiche.
- **Respecter la profondeur.** Les bâtiments masquent les inscriptions, clics compris.
- **Exporter ce qu'on voit.** Les vidéos enregistrées depuis le canvas contiennent les
  inscriptions ; en mode classique, elles n'y sont pas.
- **Une scène pour toute la ville.** Passer de l'Aqueduc au Déneigement change les surfaces
  montées dans le même canvas, sans recharger la carte.

## Matrice : la plateforme

| Capacité | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Une scène, plusieurs environnements | Oui | **Oui, mêmes surfaces remplacées dans le même canvas** | [Aqueduc](docs/territoire/bascule-1-aqueduc.png) → [Déneigement](docs/territoire/bascule-2-deneigement.png) · `bascule`, `sameMapAcrossEnvs: true` | Sélecteur d'environnement : même objet carte (`__id` 1 → 1), même canvas, un seul canvas dans la page, pas de rechargement. Les 12 surfaces de l'Aqueduc sont démontées ; restent `zone:A`, `zone:B`, `zone:C`. |
| Inscriptions dans la vidéo exportée | **Non** (carte seule) | **Oui** | [visite-hic.webm](public/territoire/visite-hic.webm) · images : [accueil](docs/territoire/visite-accueil.png), [bris](docs/territoire/visite-aqueduc.png), [décision](docs/territoire/visite-decision.png), [23 h 30](docs/territoire/visite-nuit.png) | Visite de 14,0 s, WebM VP9 1440 × 886, 2,1 Mo : l'image de la carte (1440 × 804) et, dessous, le bandeau des crédits (les quatre attributions et les deux mentions de simulation). Les parties carte sont enregistrées depuis le canvas par `recordMap` (7,8 images/s sans GPU) ; l'accueil, sans carte, est filmé à part. |
| Accueil et alertes | DOM | DOM | [accueil](docs/territoire/accueil.png) | L'accueil n'a pas de carte : HTML-in-Canvas n'y sert à rien. Ses vignettes sont de vraies captures de la scène. |
| Sans l'API | Oui | **Oui, par repli** | [sans API](docs/territoire/sans-api.png) · `sans_api` | Chrome avec `--disable-blink-features=CanvasDrawElement` : mode classique, bandeau « Votre navigateur n'active pas HTML-in-Canvas », bouton « Voir la version HTML-in-Canvas en vidéo » (la visite). |

## Matrice : Aqueduc

| Capacité | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Nom de secteur couché au sol, en perspective | Non (étiquette plate) | **Oui** | [Aqueduc à 14 h 05](docs/territoire/aqueduc-hic.png) · [sol](docs/aqueduc/sol-hic.png) | Au bris, « BRIS PROBABLE » et la conduite en cause sont écrits dans la rue. |
| Masqué par les bâtiments | **Non** | **Oui** | [classique](docs/aqueduc/occlusion-classic.png) · [canvas](docs/aqueduc/occlusion-hic.png) | Même caméra : une tour coupe l'étiquette « 4,4 bar » de P-01 ; en classique, l'étiquette Centre-ville est posée sur un bâtiment (`building: true`). Les parties cachées des marquages au sol restent visibles à 45 % (fantôme). |
| Clic bloqué sur la partie masquée | **Non** | **Oui, avec du code** | `occlusion_*` | Classique : le clic sur l'étiquette posée sur le bâtiment sélectionne le secteur. Canvas : clic sur une lettre masquée → la carte reçoit le clic (`passThrough: 1`, aucune sélection) ; sur une lettre dégagée → secteur Centre-ville sélectionné. |
| Focus clavier, Entrée ouvre la fiche | Oui | **Oui, dans la scène** | [focus](docs/aqueduc/focus-hic.png) · `focus_*` | P-01 atteint en 8 Tab (classique) et 11 Tab (canvas, élément dans le canvas). |
| Lecteur d'écran | Oui | **Oui** | `aria_classic`, `aria_hic` | Mêmes noms accessibles, avec la mention de simulation : « Capteur de pression P-01 (simulation) : 4,4 bar, normal », « Secteur Centre-ville (simulé) : 2 417 adresses desservies ». |
| Coupe sous la chaussée, vannes en vrais boutons | Dans la fiche, à plat | **Dans la scène** | [coupe](docs/aqueduc/coupe-hic.png) · `coupe_hic` | Même composant. Étape « Isolation » : conduite 13C1949, bris, pressions, boutons « V-1878 · à fermer » et « V-3573 · à fermer ». |
| Étiquettes parmi les tubes souterrains | Par-dessus tout | **Dans la scène** (même tampon de profondeur) | [souterrain](docs/aqueduc/souterrain-hic.png) | 12 568 instances de tubes (maîtresses et centre-ville), diamètres exagérés ×12, indiqué à l'écran. Les tubes sont du WebGL2 maison, présents dans les deux modes. |
| Export vidéo du scénario de bris | Carte seule | **Avec les inscriptions** | [image à 5 s, classique](docs/aqueduc/video-classic-image-5s.png) · [canvas](docs/aqueduc/video-hic-image-5s.png) | Bouton « Exporter la vidéo » du récit : WebM VP9 1440 × 866, environ 10 s. |

## Matrice : Déneigement

| Capacité | Classique | HTML-in-Canvas | Preuve | Note |
|---|---|---|---|---|
| Marquage de zone couché au sol | Non (étiquette plate) | **Oui** | [23 h 30](docs/territoire/deneigement-2330-hic.png) | Nom, état (« Stationnement interdit · 23 h – 6 h ») et un seul chiffre (avancement, ou feux et leur état). Les zones A et B, décidées à 8 h en deux gestes, sont en vigueur ; C, sans interdiction, montre « 171 feux éteints ». |
| Le marquage suit la décision et l'heure | Oui (DOM) | **Oui, recapturé** | [avant 23 h 30](docs/territoire/visite-decision.png) · [23 h 30](docs/territoire/visite-nuit.png) | Dans la visite, C est retirée de la décision par défaut : « Interdiction ce soir · 171 feux programmés » devient « 171 feux éteints », puis A et B passent à « Stationnement interdit ». Au plus une capture par élément toutes les 2 s (règle de RULES.md). |
| Clic sur le marquage → fiche | Oui | **Oui, dans la scène** | [fiche de la zone A](docs/territoire/deneigement-fiche-zone-a.png) · `fiche_zone_a` | Clic au point projeté du marquage : fiche « Zone A », décidée par vous à 8 h 00, 102 feux allumés, 8 ressources assignées, avancement. |
| Focus clavier, lecteur d'écran | Oui | **Oui** | smoke `deneigement` | Chaque marquage est un `<button>` focalisable, nommé « Zone A : état, chiffre (simulé). Ouvrir la fiche. » |
| Masqué par les bâtiments | Non | Oui, mais peu visible | | À l'échelle de la ville (zoom ≈ 11), presque rien ne dépasse devant les marquages : ici l'apport est le marquage au sol, son interaction et l'export vidéo. |
| Feux d'interdiction (simulés) | Couche de cercles | Couche de cercles | [23 h 30](docs/territoire/deneigement-2330-hic.png) | 427 points : une couche MapLibre ordinaire dans les deux modes, avec clignotement. Ce n'est pas du HTML : HTML-in-Canvas n'est pas utilisé là où il n'apporte rien. |

## Lot 2 : à venir

Collecte, Zonage et Évaluation foncière sont annoncés à l'accueil et dans le sélecteur, « À
venir ». Ce que la conception prévoit d'y inscrire dans la scène :

| Environnement | Dans la scène (HTML-in-Canvas) | Données |
|---|---|---|
| Collecte | État et heure de chaque secteur, au sol | Entièrement simulées (aucun jeu ouvert) |
| Zonage | Codes de zone posés au sol en perspective, masqués par les bâtiments ; comparaison de deux zones | Réelles (1 666 zones, CC-BY 4.0) |
| Évaluation | Valeur de l'unité sélectionnée et total d'un secteur dessiné à la main | Réelles (rôle 2026, caviardé, sans réidentification) |

## Ce qui n'est pas propre à HTML-in-Canvas

**Le texte au sol seul.** MapLibre pose déjà du texte à plat sur le sol avec une couche de
symboles (`text-pitch-alignment: "map"`). La différence réelle est que la scène contient du
**HTML** : interactif, focalisable, accessible, et masqué par les bâtiments, clics compris. Le
mode classique affiche les mêmes composants React en étiquettes plates, pour que la comparaison
porte sur le même contenu.

**Fantôme à 45 % (`GROUND_GHOST`).** La partie d'un marquage au sol cachée par un bâtiment n'est
pas effacée mais dessinée à 45 % d'opacité, pour que le chiffre d'un secteur reste lisible
derrière un immeuble. Les clics sur la partie cachée restent bloqués. Les étiquettes des capteurs,
elles, sont masquées complètement.

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

Section secondaire : la démo vise les possibilités de l'API, pas les chiffres. Ces mesures datent
du 25 novembre 2026 (`bench/results/aqueduc-meta.json`) et ont été prises sur la démo du réseau
d'eau seule, avant le passage à l'outil de territoire ; elles portent sur les mêmes couches et
étiquettes que l'environnement Aqueduc. Le banc vise maintenant `/carte/aqueduc` et tourne
toujours (essai `npm run bench:aqueduc -- --quick`, une configuration par mode, 37 s, sans
erreur), mais la campagne complète n'a pas été refaite.

**Machine sans GPU** : WebGL2 = ANGLE + SwiftShader (logiciel), Chromium 158.0.8127.36 headless,
Intel Xeon 2,1 GHz × 4, vue 1280×800, DPR 1, 2 répétitions, environ 12 min
(`bench/results/aqueduc.csv`, section « Réseau d'eau » de `/bench`). Valeurs = moyennes des deux
répétitions.

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
  et les redessins qu'elles déclenchent coûtent cher en WebGL logiciel.
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

**Dans un outil de gestion du territoire, l'approche tient ses promesses fonctionnelles.** La
carte 3D est le produit : un état d'interdiction appartient à une zone, une pression à un point
du réseau, une vanne à une rue. HTML-in-Canvas permet de les inscrire dans la scène en gardant du
vrai HTML : boutons focalisables, noms accessibles avec leur mention de simulation, clics bloqués
derrière les immeubles, fiches ouvertes depuis la scène, et des vidéos exportées qui contiennent
les inscriptions. Une même scène porte plusieurs services de la ville : changer d'environnement
remplace les surfaces dans le même canvas. Le mode classique montre la même information, mais
par-dessus la ville, sans profondeur, et rien de tout cela n'apparaît dans les vidéos.

**Le bon usage reste sobre.** Peu d'éléments dans la scène, choisis par environnement, par
couche active et par état ; tout le reste (panneau, fiche, frise, accueil, alertes) en DOM
ordinaire. Les feux du déneigement, de simples points, restent une couche MapLibre. Les captures
ont un coût réel sans GPU (mesures ci-dessus), et le mode classique reste indispensable : l'API
est expérimentale (flag ou Origin Trial) et chaque visiteur sans elle y bascule.
