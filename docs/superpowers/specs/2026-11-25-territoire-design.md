# Démo « Gestion du territoire 3D » : conception

Date : 25 novembre 2026. Demandée par David. Ville : Trois-Rivières.
Base : branche `claude/aqueduc-seul` (PR #3), où le dépôt ne contient plus que la démo du réseau d'eau.

## 1. Intention

La démo du réseau d'eau a montré qu'HTML-in-Canvas tient ses promesses quand la 3D est le
produit. David veut aller plus loin : passer d'un seul service (l'aqueduc) à **un outil de
gestion du territoire municipal**, côté administration, qui couvre plusieurs services de la
ville sur la même carte 3D.

L'inspiration vient des portails cartographiques citoyens des villes, comme celui de
Rivière-du-Loup (évaluation, collecte, zonage, déneigement, rinçage). Mais ici on construit des
**vues de gestionnaire**, pas des cartes citoyennes, sur les données ouvertes de Trois-Rivières.

Ce que David veut montrer : **les possibilités d'HTML-in-Canvas dans un contexte réel de
gestion du territoire**. Les indicateurs de performance passent au second plan.

Le gestionnaire **consulte l'outil de temps en temps**, pas comme un rituel du matin. En
arrivant, il voit d'un coup d'œil ce qui se passe dans la ville, choisit dans quel
environnement (service) entrer, et peut y faire les opérations de ce secteur d'activité. Les
alertes sont au cœur de l'outil.

Succès : un visiteur arrive sur l'accueil, comprend en quelques secondes qu'il regarde une ville
avec plusieurs services, voit les alertes en cours, entre dans un environnement, fait une
opération (par exemple décréter une interdiction de stationner), passe à un autre environnement
sans que la carte se recharge, et comprend que c'est une démo non officielle avec des données
ouvertes et des simulations.

## 2. Objectifs, non-objectifs, anti-objectifs

**Objectifs**
- Un **écran d'accueil** familier (choix de David) : alertes actives, puis une carte par
  environnement, qui mène aux vues 3D.
- Cinq environnements sur une même scène 3D persistante : **Aqueduc**, **Déneigement**,
  **Collecte**, **Zonage**, **Évaluation foncière**.
- Une **navigation intuitive entre les cartes** : changer d'environnement fait voler la caméra
  et change les inscriptions de la scène, sans recharger la carte.
- Des **opérations par environnement**, faites dans la scène quand HTML-in-Canvas y a un sens.
- Une **horloge simulée commune** à toute la ville, avec une journée scénarisée.
- Des **alertes** produites par chaque environnement, visibles partout.
- Une interface **plus professionnelle** que la démo actuelle, inspirée de références Mobbin
  (voir 5.3).
- Une section **« À propos »** explicite : démo non officielle, sources et licences, ce qui est
  simulé.

**Non-objectifs**
- **Rapports** par vue : un lot ultérieur (David : « après ça, on va pouvoir sortir des
  rapports »).
- Envoi de courriels ou de notifications pour les alertes (David : « on ne va pas simuler non
  plus l'envoi de courriel »).
- Suivi réaliste des bacs ramassés (David : on simplifie à l'état du secteur).
- Données réelles de déneigement ou de collecte : elles n'existent pas en données ouvertes.
- Authentification, rôles d'utilisateur, plusieurs villes.
- Modification du zonage ou du rôle : consultation seulement.

**Anti-objectifs** (ce qui ferait échouer la démo même si elle fonctionne)
- **Trop de widgets et de cartes.** Règle reprise de la démo précédente : chaque élément
  d'interface doit mériter sa place.
- **Ressembler à un site officiel** : aucun logo, nom de marque, gabarit ou texte copié d'une
  ville (Trois-Rivières ou Rivière-du-Loup). Rien ne doit laisser croire que la Ville a produit
  ou approuvé la démo.
- **Réidentifier des propriétaires** : le rôle ouvert est caviardé et la réidentification est
  interdite. Aucun nom, aucun croisement qui y mènerait.
- **Mettre les chiffres de performance au premier plan.**
- **Recharger la carte** en changeant d'environnement.

## 3. Contraintes

- Pile existante : Next.js 16 App Router (changements incompatibles : lire
  `node_modules/next/dist/docs/` avant d'écrire du code Next), TypeScript, Zustand, MapLibre GL
  6.19, tuiles OpenFreeMap, couches WebGL2 personnalisées, hôte HTML-in-Canvas
  (`src/client/hic3d/`).
- Règles HTML-in-Canvas de `RULES.md`, inchangées : rendu à la demande, upload seulement dans
  `paint`, vérification `readPixels` et repli classique, au plus une capture par élément toutes
  les 2 s, au plus 8 uploads par `paint`, hit testing avec occlusion, etc.
- Mode classique obligatoire pour tout visiteur sans l'API, comme aujourd'hui ; bandeau et
  vidéo pour le visiteur sans l'API conservés.
- État propre à chaque visiteur, sans base de données (Postgres a été retiré).
- Interface et documentation en français. Toute donnée simulée porte la mention
  « Simulation » ou « simulé ».
- Attribution visible partout où des données apparaissent, y compris dans les vidéos exportées.
- Données ouvertes utilisées (toutes vérifiées sur l'API CKAN de Données Québec le 25 nov. 2026) :

| Jeu | Éditeur | Licence | Contenu utile |
|---|---|---|---|
| Réseau d'aqueduc (déjà intégré) | Ville de Trois-Rivières | CC-BY 4.0 | Conduites |
| Zonage (`zonage-v3r`) | Ville de Trois-Rivières | CC-BY 4.0, mis à jour chaque semaine | 1 666 zones : `NO_ZONE`, `ZONAGEMUNICIPALID` (ex. `CNA-1027`), `GROUPEUSAGE` (ex. `CNA`), `V_DESCRIPTION` (ex. « Conservation naturelle »), `STATUT`, `DATEDEBUT` ; GeoJSON 5,3 Mo, dictionnaire PDF |
| Stationnement de nuit (`stationnement-de-nuit`) | Ville de Trois-Rivières | CC-BY 4.0, annuel | 3 polygones : Zone A, Zone B, Zone C (`V_DetailZone`) ; GeoJSON 40 Ko |
| Rôles d'évaluation foncière du Québec 2026 | MAMH | CC-BY 4.0, annuel ; renseignements personnels caviardés, réidentification interdite | Géoréférencé pour tout le Québec (GPKG 573 Mo) ; XML par municipalité (`RL37067_2026.xml`, 97 Mo, code 37067 = Trois-Rivières) |

- Pas de collecte automatisée massive des tuiles OpenFreeMap. Les jeux ouverts sont prétraités
  une fois par script, versionnés en fichiers compacts, sans appel en direct aux portails.

## 4. Approches envisagées

**A. Une page par environnement.** Une route par environnement, chacune avec sa propre carte.
Le plus simple, et chaque environnement est isolé. Mais changer d'environnement recharge la
carte (1 à 2 s, caméra remise à zéro) : la navigation entre cartes est saccadée, alors que
c'est le cœur de la demande.

**B. Une scène persistante, des environnements « modules » (choisie par David).** L'accueil
`/`, puis `/carte/[environnement]`. La carte vit dans la mise en page commune aux routes
`/carte/*` et ne se recharge pas d'un environnement à l'autre. Chaque environnement est un
module qui apporte ses couches, ses inscriptions HTML-in-Canvas, son panneau d'opérations et
ses règles d'alerte ; l'horloge et le moteur d'alertes sont communs. Plus de travail au
départ (interface de module, migration de l'aqueduc), mais une navigation fluide et une ville
cohérente.

**Écartée : une seule page sans URL par environnement.** Pas de lien partageable, et le
bouton Précédent ne fait rien d'utile.

**Données (même choix dans A et B) :** prétraitement des jeux ouverts en fichiers compacts
versionnés, comme pour les conduites.

## 5. Ce qui est décidé

### 5.1 Routes et navigation

- `/` : **accueil** (choix de David, « plus familier »). Il remplace la carte de l'aqueduc à
  cette adresse.
- `/carte/[env]` avec `env` ∈ `aqueduc`, `deneigement`, `collecte`, `zonage`, `evaluation`.
  La scène MapLibre est montée dans `src/app/carte/layout.tsx` (ou équivalent selon la doc de
  Next 16) et survit à la navigation entre environnements. Le mode reste réglable par
  `?mode=classic|hic` comme aujourd'hui.
- Dans une vue 3D, un **sélecteur d'environnement** permet de passer à un autre sans revenir
  à l'accueil. Changer d'environnement : vol de caméra vers le cadrage de l'environnement,
  remplacement des couches et des inscriptions, URL mise à jour.
- `/bench` reste accessible mais discret (lien dans « À propos »). L'indicateur de
  performance (« PerfChip ») sort de la barre d'application ; il peut rester accessible depuis
  « À propos » ou un menu secondaire.
- **« À propos »** : une page ou une boîte de dialogue complète, accessible depuis l'accueil
  et la barre. Contenu obligatoire :
  - « Démo non officielle. Ni la Ville de Trois-Rivières ni aucune autre municipalité n'a
    produit, vérifié ou approuvé cette démo. »
  - Le tableau des sources (jeu, éditeur, licence, lien vers Données Québec) et l'attribution
    du fond de carte.
  - Ce qui est réel et ce qui est simulé, environnement par environnement.
  - Ce que montre HTML-in-Canvas, en quelques lignes, avec le lien vers le banc.
- Le pied de l'accueil répète en une ligne : « Démo non officielle · données ouvertes CC-BY
  4.0 · À propos ».

### 5.2 Horloge commune et journée scénarisée

Une seule horloge simulée pour toute la ville (elle remplace l'horloge propre à l'aqueduc). La
frise 24 h est commune à tous les environnements. On arrive sur « maintenant » : l'heure
locale réelle (America/Toronto) appliquée à la journée scénarisée. On peut avancer, reculer
et accélérer (×1, ×60) comme aujourd'hui.

Journée scénarisée (validée par David) :

```
06 h  levée automatique de l'interdiction de stationner de la veille
07 h  collecte : secteurs « en cours » les uns après les autres
14 h  bris de conduite au centre-ville (scénario actuel de l'aqueduc)
19 h  neige prévue → alerte « décréter l'interdiction ? »
23 h  interdiction en vigueur, ressources sur le terrain
```

À toute heure, l'accueil a quelque chose de vivant à montrer, et la section « À venir » de
l'accueil annonce le prochain événement.

Le scénario guidé du bris (récit, coupe, vannes) reste disponible dans l'environnement Aqueduc.

**Choix du concepteur (à vérifier par David) :**
- **Le bris existe sur l'horloge commune** à partir de 14 h pour tout visiteur, en
  exploration libre comme dans le récit : le flux des capteurs le contient dès que l'heure
  simulée dépasse 14 h. Le scénario guidé devient un récit posé sur cet événement ; ses
  étapes sont décalées pour commencer à 14 h. La réparation peut chevaucher la neige de 19 h,
  ce qui est réaliste.
- **Actions datées en temps simulé.** Chaque opération du visiteur (interdiction, ressources,
  vannes, rinçage) est enregistrée avec son heure simulée. Reculer avant une action la fait
  disparaître de l'affichage, sans l'effacer ; avancer à nouveau la fait réapparaître. Les
  alertes et les états sont des fonctions pures de l'heure et de ces actions.
- **Fin de journée.** À 24 h, la journée recommence à 0 h avec les actions du visiteur
  remises à zéro.
- **Vidéo et preuves.** L'interface change ; la vidéo pour le visiteur sans l'API et les
  preuves (`scripts/aqueduc-proofs.ts`) sont refaites au lot 1 pour montrer l'outil de
  territoire (accueil, puis aqueduc et déneigement).

### 5.3 Interface

Références Mobbin retenues (à adapter, pas à copier) :
- [Felt](https://mobbin.com/screens/58a17ddb-ae85-48cf-96d8-aa8c632517d7) : carte plein
  écran, panneaux légers qui flottent dessus, fiche d'élément sobre.
- [komoot](https://mobbin.com/screens/6f8bb5fc-baf6-40ae-ac5c-1ab61cf70104) et
  [Apple](https://mobbin.com/screens/436dd723-caf8-4c10-a772-4db428c5858a) : changer de
  carte avec des vignettes visuelles plutôt qu'une liste de cases à cocher.
- [Searchable](https://mobbin.com/screens/2c836385-d043-4424-b0d0-ca6d0e723438) : résumé des
  alertes par gravité.
- [Shopify](https://mobbin.com/screens/ebe2401d-db79-4367-92da-cce968a474b7) : alertes dans
  un menu déroulant depuis la cloche de la barre.

**Accueil** (esquisse validée dans la conversation) :

```
┌──────────────────────────────────────────────────────────────┐
│ ◧ Territoire · Trois-Rivières (démo)        ⚠ 3 alertes   ⓘ │
├──────────────────────────────────────────────────────────────┤
│  Vue d'ensemble · mardi 24 nov., 14 h 05                     │
│  ┌ ⚠ 1 critique · 2 à surveiller ─────────────────────────┐  │
│  │ ● Bris de conduite 13C1949 · Centre-ville  → Ouvrir    │  │
│  │ ● Déneigement : stationnement interdit dès 23 h → …    │  │
│  └─────────────────────────────────────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐          │
│  │ 💧 Aqueduc    │ │ ❄ Déneigement│ │ ♻ Collecte   │          │
│  │ ● 1 bris     │ │ ● Opération  │ │ ✓ Tournées   │          │
│  │ [mini-carte] │ │ [mini-carte] │ │ [mini-carte] │          │
│  └──────────────┘ └──────────────┘ └──────────────┘          │
│  ┌──────────────┐ ┌──────────────┐                           │
│  │ ▦ Zonage      │ │ $ Évaluation │                           │
│  └──────────────┘ └──────────────┘                           │
│  Démo non officielle · données ouvertes CC-BY 4.0 · À propos │
└──────────────────────────────────────────────────────────────┘
```

- En haut : les alertes actives, résumées par gravité, chacune avec « Ouvrir » qui mène à
  l'environnement et centre la scène sur l'objet.
- Une carte par environnement : nom, état en une ligne (simulé ou réel selon le cas),
  mini-carte. Cliquer ouvre `/carte/[env]`.
- Pied : l'avertissement « non officiel » et le lien « À propos ».

**Vue 3D d'un environnement.** Budget d'interface au-dessus de la carte :
- barre d'application (nom de l'outil, environnement courant, recherche, cloche des alertes,
  « À propos ») ;
- sélecteur d'environnement à vignettes ;
- panneau des couches et des opérations de l'environnement ;
- frise 24 h commune ;
- fiche, seulement à la sélection ;
- récit, seulement pendant le scénario du bris.

**Recherche (choix du concepteur) :** au lot 1, la recherche couvre ce que les données
chargées contiennent : secteurs, zones de stationnement de nuit, conduites, capteurs,
ressources de déneigement. Les adresses s'ajoutent au lot 2 avec le rôle d'évaluation. Aucun
géocodeur externe.

Une seule valeur par étiquette de capteur, un seul chiffre par marquage de secteur, comme
aujourd'hui. Un système visuel commun : jetons de couleur, typographie (Inter et JetBrains Mono
déjà auto-hébergées), espacements, gravités (critique, attention, info) et états.

### 5.4 Modules d'environnement

Chaque environnement est un module avec la même forme. Le constructeur fixe les signatures ;
le module apporte :
- son cadrage de caméra par défaut ;
- ses couches MapLibre et ses couches WebGL éventuelles ;
- ses surfaces HTML-in-Canvas (inscriptions dans la scène), filtrées par pertinence ;
- son panneau d'opérations et sa fiche ;
- ses règles d'alerte, fonction pure de l'horloge et de l'état du visiteur ;
- son résumé pour la carte de l'accueil ;
- ses données, chargées seulement quand l'environnement est ouvert, ou par l'accueil pour son
  résumé.

| Environnement | Ce qu'on voit | Opérations | Dans la scène (HIC) | Réel / simulé |
|---|---|---|---|---|
| **Aqueduc** | Ce qui existe : pressions, bris, rinçage, vue souterraine | Isoler un bris (scénario actuel), planifier un rinçage de secteur | Ce qui existe (marquages, capteurs, coupe) | Conduites réelles ; capteurs et bris simulés |
| **Déneigement** | Les 3 zones de stationnement de nuit, l'interdiction en vigueur, les ressources assignées, l'avancement par zone | Décréter l'interdiction de stationner la nuit sur une ou plusieurs zones, rapidement (deux gestes) ; assigner des ressources (équipes, chenillettes, souffleuses, camions) à une zone. La levée se fait seule à 6 h (David). | Au sol, par zone : « Stationnement interdit · 23 h – 6 h », avancement ; ressources assignées montrées dans la zone | Zones réelles ; météo, ressources, avancement simulés |
| **Collecte** | Les secteurs de collecte du jour et leur état : à venir, en cours, terminé | Consulter l'horaire d'un secteur. Pas de suivi bac par bac (David). | Au sol, par secteur : état et heure | Entièrement simulé (aucun jeu ouvert trouvé) |
| **Zonage** | Les 1 666 zones colorées par groupe d'usage, codes de zone | Fiche de zone (code, groupe d'usage, description, statut, date) ; comparer deux zones côte à côte | Codes de zone posés au sol en perspective, masqués par les bâtiments | Réel (le règlement fait foi ; le détail des usages permis n'est pas dans les données, la fiche le dit) |
| **Évaluation** | Les unités d'évaluation colorées par valeur | Fiche de l'unité (adresse, utilisation, valeurs terrain / bâtiment / totale, année de construction, logements selon disponibilité) ; total d'un secteur dessiné à la main | Valeur de l'unité sélectionnée, total du secteur dessiné, posés dans la scène | Réel (rôle 2026, caviardé) |

Alertes (proposition, à affiner par le constructeur dans le même esprit) :
- Aqueduc : celles d'aujourd'hui (bris, basse pression, qualité).
- Déneigement : à 19 h, « Neige prévue — décréter l'interdiction ? » (attention), qui devient
  critique si rien n'est décrété à 21 h ; « Interdiction en vigueur » (info) de 23 h à 6 h.
- Collecte : un retard simulé sur un secteur dans la journée (attention).
- Zonage et Évaluation : pas d'alerte (données de référence).

### 5.5 Lots

C'est un projet ; on le livre en deux lots, chacun avec sa PR :
1. **Lot 1 : la plateforme et deux environnements.** Accueil, scène persistante
   `/carte/[env]`, sélecteur d'environnement, horloge commune et journée scénarisée, moteur
   d'alertes, « À propos », nouveau système visuel, **Aqueduc** migré en module, **Déneigement**.
2. **Lot 2 : les trois autres environnements.** **Collecte**, **Zonage**, **Évaluation**, avec
   leurs scripts de données.

Les rapports viendront dans un lot ultérieur, hors de cette conception.

### 5.6 Visiteur sans l'API, performance, documentation

- Le bandeau, la vidéo et le repli classique actuels s'appliquent à tous les environnements.
- Le banc existant (`/bench`, `npm run bench:aqueduc`) reste, sans nouvelle campagne de mesures
  obligatoire. Le README et CAPABILITIES.md sont mis à jour pour l'outil de territoire, en
  insistant sur les possibilités d'HTML-in-Canvas plutôt que sur les chiffres.
- `SOURCE.md` par jeu de données (comme `data/aqueduc/SOURCE.md`) : provenance, licence, date
  d'extraction, transformations.

## 6. Laissé au constructeur

- La forme exacte de l'interface de module et le découpage des fichiers.
- Comment garder la scène vivante entre routes sœurs avec Next 16 (mise en page, groupe de
  routes, ou équivalent documenté).
- Les formats compacts des données prétraitées, la simplification des géométries du zonage, et
  le budget de taille par environnement.
- Comment extraire Trois-Rivières du rôle géoréférencé (GPKG) et, au besoin, compléter avec le
  XML municipal ; comment représenter les unités (points, colonnes extrudées, jointure aux
  bâtiments du fond de carte).
- La délimitation des secteurs de collecte simulés (par exemple les secteurs déjà définis pour
  l'aqueduc).
- Le détail des ressources de déneigement simulées (nombre, types, dépôts) et de l'avancement.
- Les mini-cartes de l'accueil (images générées ou cartes légères).
- Le contenu des alertes au-delà de 5.4, dans le même esprit.
