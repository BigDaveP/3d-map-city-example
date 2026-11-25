# Démo « Réseau d'eau potable 3D » : conception

Date : 24 novembre 2026. Demandée par David. Ville : Trois-Rivières (réseau réel, capteurs simulés).

## 1. Intention

Le dépôt contient deux démos HTML-in-Canvas : un mur de supervision (`/`) et une carte de
livraison 3D (`/carte`). Elles ont montré ce que l'API sait faire, mais la carte de livraison
ressemble à un mur de panneaux, peu crédible comme outil réel, et rien ne guide un visiteur
externe d'une démo à l'autre.

La nouvelle démo devient **la démo par défaut** : le réseau d'aqueduc réel de Trois-Rivières
sur une carte 3D, avec des capteurs simulés (débit, pression, qualité de l'eau, problèmes),
pensée pour un **directeur des travaux publics**. Elle doit donner un visuel convaincant de
**l'utilité** de la fonctionnalité expérimentale et de **la performance qu'on peut en
attendre**.

Succès : un visiteur externe arrive sur `/`, comprend en quelques secondes ce qu'il regarde,
suit un scénario de bris qui montre ce que le DOM ne peut pas faire, explore librement, compare
les deux modes et voit les chiffres de performance, sans explication orale.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Interface au niveau de qualité d'Esri/ArcGIS (pas une copie) : sobre, dense là où il faut,
  cohérente.
- Information présentée **dans la scène** plutôt que dans des fenêtres flottantes.
- Exploration libre d'un réseau vivant **et** scénario guidé de bris, rejouable.
- Vue souterraine avec de vraies conduites 3D.
- Comparaison classique / HTML-in-Canvas sur la même vue et mesures de performance visibles.
- Navigation claire entre les démos du dépôt.

**Non-objectifs**
- Modèle hydraulique réaliste (type EPANET) : une simulation plausible suffit.
- Usage mobile complet : la page ne doit pas casser sur téléphone, sans plus.
- Données réelles de capteurs, de vannes ou d'adresses : elles n'existent pas en données ouvertes.

**Anti-objectifs** (ce qui ferait échouer la démo même si elle fonctionne)
- **Trop de widgets et de cartes.** David : « tant que les widgets, cards ne font pas
  too-much et que c'est pertinent ». Chaque élément d'interface doit mériter sa place.
- Retomber dans le système de panneaux flottants ouverts en grand nombre (rejeté par David).
- Présenter des données simulées comme réelles.
- Une démo qui n'a de sens que commentée par quelqu'un.

## 3. Contraintes

- **Dépôt et pile existants** : Next.js 16 (App Router, Turbopack), TypeScript, Zustand,
  Postgres + Drizzle avec repli en mémoire, MapLibre GL JS 6.19, tuiles OpenFreeMap « liberty »,
  WebGL2 maison, Playwright, Dockerfile. Lire `node_modules/next/dist/docs/` avant d'écrire du
  code Next (instruction d'`AGENTS.md`).
- **Règles HTML-in-Canvas déjà établies** (`RULES.md`, `CAPABILITIES.md`, conservées telles
  quelles) : rendu à la demande ; upload uniquement dans le gestionnaire `paint` ; textures en
  pixels du backing store ; vérification par `readPixels` et repli classique automatique si
  texture vide ou aucun `paint` en 2,5 s ; `updateElementGeometry` (px CSS) pour chaque élément
  monté ; montage après hydratation par portail React ; vue SSR lisible sans JavaScript ; ce
  qui change souvent reste en WebGL et le HTML capturé est limité à une capture par élément
  toutes les 2 s ; sauvegarde et restauration de l'état GL de MapLibre autour des uploads ;
  hit testing avec occlusion par requêtes d'occlusion (l'API seule l'ignore).
- **Données** : conduites de la Ville de Trois-Rivières, Données Québec, licence CC-BY 4.0,
  attribution obligatoire et visible. 24 142 tronçons avec diamètre, matériau, année
  d'installation, classe fonctionnelle (amenée, maîtresse, distribution, branchements), nœuds
  de départ et d'arrivée (dont réservoirs et prise d'eau). Pas de vannes, pas de profondeur,
  pas d'adresses desservies, pas de bris historiques.
- **OpenFreeMap** : attribution affichée ; pas de collecte automatisée massive (les bancs
  restent courts).
- **Ville interchangeable** : Rivière-du-Loup pourrait remplacer Trois-Rivières si David obtient
  un export de la Ville. La ville est une configuration, pas du code.
- **Environnement de développement sans GPU** (SwiftShader) : les mesures prises ici le disent ;
  le banc et les preuves sont faciles à relancer sur la machine de David.
- **Langue** : interface et documentation en français.
- **Git** : commits atomiques, David co-auteur dans chaque commit. Travail sur une nouvelle
  branche `claude/aqueduc-3d` partant de `claude/carte-3d-html-in-canvas` (PR ouverte :
  BigDaveP/Dashboard-Example-HTML-in-Canvas#1), poussée sur GitHub (accord de David). À la fin,
  une PR **directement vers `main`** (décision de David) ; elle contiendra aussi les commits de
  la PR n°1 tant que celle-ci n'est pas fusionnée.
- `npm run build` et le build Docker doivent passer.

## 4. Approches envisagées

1. **Prolonger l'architecture de `/carte`** : MapLibre, custom layer qui partage la profondeur
   des bâtiments, store, SSE, métriques et export vidéo existants. Le système de panneaux
   devient un système de surfaces HTML (au sol, face caméra, plan vertical). Peu risqué, mesures
   comparables au rapport précédent.
2. **Moteur 3D (three.js ou deck.gl) par-dessus MapLibre** pour de vrais tubes enterrés.
   Spectaculaire, mais grosse dépendance, intégration HTML-in-Canvas et hit testing à refaire,
   état GL modifié par le moteur, mesures non comparables.
3. **Toile superposée synchronisée** (option B du premier prototype) : perd la profondeur
   partagée, donc l'occlusion par les bâtiments, qui est le cœur de la démonstration.

**Choix de David : 1, plus une vue souterraine avec de vrais tubes 3D dans la même scène**,
dessinés en WebGL2 maison (custom layer MapLibre supplémentaire, même tampon de profondeur),
sans three.js ni deck.gl. Faire deux démos séparées (1 et 2) a été écarté : double intégration,
double maintenance.

## 5. Ce qui est décidé

### 5.1 Place dans le dépôt et navigation

- `/` devient la démo aqueduc. Le mur de supervision passe à `/mur`. `/carte`, `/lab` et
  `/bench` restent. Les scripts, tests et liens qui visent `/` pour le mur sont mis à jour.
- Une barre d'application commune à toutes les démos porte un menu « Démos » (aqueduc, mur,
  livraison, banc) avec une phrase par démo, et un bouton « À propos de cette démo » qui dit ce
  qu'on regarde, ce qui est simulé et quoi essayer.
- Le README présente l'aqueduc en premier.

### 5.2 Données

- Les conduites réelles sont téléchargées une fois depuis Données Québec par un script
  (`npm run aqueduc:data` ou équivalent), réduites (champs utiles, coordonnées arrondies) et
  **versionnées dans le dépôt** avec leur date d'extraction et leur attribution, pour que la
  démo et l'image Docker fonctionnent sans réseau.
- Une configuration de ville (centre, emprise, zone de démo, nom, attribution, fichier de
  données) permet de changer de ville.
- **Simulé, et étiqueté comme tel partout** :
  - capteurs placés sur de vrais nœuds : une quarantaine de points de pression et de débit sur
    les conduites maîtresses, une dizaine de stations de qualité (chlore résiduel, turbidité,
    pH, température), niveau des réservoirs, un débitmètre par secteur ;
  - secteurs de distribution (une dizaine, nommés d'après les quartiers réels) ;
  - vannes aux intersections du graphe ;
  - nombre d'adresses desservies par tronçon, estimé (estimation affichée comme telle) ;
  - historique de bris, campagne de rinçage 2026 par secteur.
- **Modèle** (plausible, déterministe pour une heure donnée) :
  - pression de base selon la distance dans le graphe depuis les réservoirs et la prise d'eau,
    modulée par une courbe de demande sur 24 h (pointes matin et soir, minimum la nuit) ;
  - chlore résiduel qui décroît avec « l'âge de l'eau » (distance depuis l'usine) ;
  - un secteur avec une fuite invisible : débit de nuit anormalement élevé ;
  - bris : chute de pression qui s'atténue avec la distance dans le graphe, pointe de débit
    entrant ; isolation = fermeture des vannes qui coupent le plus petit sous-graphe autour du
    tronçon ; les tronçons isolés passent à pression nulle ;
  - après réparation : remise en eau, turbidité temporaire, contrôle du chlore, avis
    d'ébullition préventif si le chlore est sous le seuil.
- Seuils affichés : chlore résiduel ≥ 0,2 mg/L, turbidité, pH. Le constructeur choisit des
  valeurs plausibles et cite leur source dans la documentation.
- **Horloge simulée** : temps réel ou accéléré (×60) ; frise de 24 h ; l'état dépend de
  l'heure simulée.
- **État propre à chaque visiteur** (choix du concepteur : une démo publique ne doit pas montrer
  le bris d'un visiteur à tous les autres). Le modèle est un module déterministe partagé entre
  serveur et client. Les valeurs des capteurs arrivent par un flux SSE **par connexion**,
  paramétré par l'horloge du visiteur (heure de départ, vitesse), pour garder un vrai chemin de
  données serveur → pixel mesurable. Les actions du visiteur (fermer les vannes, publier un avis)
  passent par des Server Actions qui valident et renvoient le nouvel état, conservé côté client
  pour la session ; pas de nouvelle table Postgres pour l'aqueduc.
- **Le scénario a sa propre ligne de temps** (06:58 → rapport) qui remplace l'horloge vivante
  pendant sa lecture ; « Explorer librement » ou la fin du scénario ramène au réseau vivant à
  l'heure où on l'avait quitté.

### 5.3 Interface : pistes A et C, avec la fiche de B

Maquettes validées : https://claude.ai/artifact/CLUxqYtBKUjAPKcnFvYHkw (pistes A, B et C ;
David retient A + C + la fiche de B).

**Budget d'interface** (rien d'autre ne flotte au-dessus de la carte) :
1. barre d'application (nom, mention « Simulation », recherche, horloge, bascule
   Classique / HTML-in-Canvas, puce de performance) ;
2. couches, repliables ;
3. frise de 24 h en bas (courbe du secteur ou de l'élément sélectionné, évènements) ;
4. fiche ancrée à droite, **seulement quand un élément est sélectionné** ;
5. récit à gauche, **seulement pendant le scénario**.

**Dans la scène (mode HTML-in-Canvas)** :
- marquage au sol : nom de chaque secteur avec **un seul** chiffre ; marquage d'un incident
  sur la rue elle-même (nature, conduite, valeur clé) ; zone qui serait privée d'eau ;
- capteurs : petite étiquette face caméra avec **une seule valeur**, couleur selon l'état ;
- conduites colorées selon la couche active (pression par défaut) ;
- scénario : coupe verticale sous la chaussée au moment de l'isolation, avec la conduite, la
  pression le long du tronçon et les vannes, qui sont de vrais boutons.
- Ces surfaces sont du HTML réel : focus clavier, lecteur d'écran, masquées par les bâtiments,
  clics bloqués quand elles sont masquées.

**Mode classique** : même information en DOM (marqueurs, étiquettes plates, coupe en
illustration 2D dans la fiche). La différence entre les deux modes est le sujet de la démo.

**Couches** : Pression (par défaut), Qualité de l'eau, Âge et matériau (plan d'intervention),
Rinçage 2026, Incidents.

**Fiche** selon la sélection : tronçon (identifiant, diamètre, matériau, année, longueur,
pression, débit, bris antérieurs), capteur (valeur, seuil, courbe 24 h), secteur (adresses
desservies, consommation, débit de nuit), incident (étapes d'intervention, actions).

**Scénario de bris** : conduite maîtresse 13C1949, 300 mm, fonte grise de 1920, près de la rue
des Forges (choisie dans les vraies données). Cinq étapes : détection, isolation (coupe),
intervention, rétablissement, rapport (export vidéo de la séquence). Boutons précédent /
suivant, « Explorer librement » rend la main à tout moment, relançable.

**Qualité visuelle** : jetons de design, Inter et une police à chiffres, espacements
réguliers, états visibles au clavier, contrastes suffisants, attribution visible. Une vue SSR
sans JavaScript résume l'état du réseau, les incidents et les secteurs.

### 5.3 bis Visiteur sans l'API (décision de David)

- Détection existante : sans l'API, bascule automatique en mode classique.
- Bandeau clair : « Votre navigateur n'active pas HTML-in-Canvas : vous voyez la version
  classique », avec deux actions :
  - **Voir la version HTML-in-Canvas en vidéo** : vidéos enregistrées du scénario (produites
    par le script de preuves) intégrées à la page ;
  - **Comment l'activer** : le flag `chrome://flags/#canvas-draw-element`, en une ligne.
- Prise en charge d'un jeton Origin Trial par variable d'environnement (injecté dans
  l'en-tête de la page). Le domaine d'hébergement n'est pas encore connu ; sans jeton, rien ne
  change.

### 5.4 Vue souterraine

- Bouton « Vue souterraine » : le sol et les routes s'estompent, les bâtiments deviennent
  translucides, les conduites apparaissent en tubes 3D à environ 2 m de profondeur.
- Tubes dessinés par une custom layer WebGL2 maison (géométrie instanciée), dans le même
  contexte et le même tampon de profondeur que MapLibre et les surfaces HTML.
- Le diamètre réel est trop petit pour être visible à l'échelle de la ville : il est exagéré
  d'un facteur fixe, **indiqué à l'écran**. La couleur suit la couche active.
- Par défaut : conduites maîtresses et zone du centre-ville (environnement sans GPU) ; un
  réglage affiche tout le réseau.
- En vue normale, les conduites restent des lignes au sol.

### 5.5 Performance

- Puce de performance dans la barre (images/s, temps JS) ; un clic ouvre le détail (métriques
  existantes de `/carte`).
- Banc `npm run bench:aqueduc` : modes classique et HTML-in-Canvas ; vue normale, vue
  souterraine, lecture du scénario ; plusieurs densités d'étiquettes dans la scène ; tubes
  limités ou réseau complet. Mesures : images/s, temps JS p95, captures par minute, latence
  valeur de capteur → pixel. Méta avec l'indicateur GPU.
- Les résultats alimentent `/bench` et `CAPABILITIES.md`, avec mention explicite des mesures
  prises sans GPU.
- Script de preuves (captures et vidéos) relançable, comme `npm run proofs:carte`.

### 5.6 Livrables

Code, tests (graphe et isolation, déterminisme de la simulation, géométrie des surfaces),
README, section aqueduc dans `CAPABILITIES.md`, preuves dans `docs/aqueduc/`, banc et
résultats, `npm run build` et build Docker qui passent, commits atomiques co-signés par David.

## 6. Laissé au constructeur

Format exact des données réduites, algorithme de découpage des secteurs, nombre exact de
capteurs, structure des modules, détails visuels dans le respect des maquettes et du budget
d'interface, réutilisation ou réécriture de `/carte` (qui doit continuer de fonctionner),
facteur d'exagération des tubes.
