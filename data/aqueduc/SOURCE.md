# Source des données d'aqueduc

- **Jeu de données** : Conduites d'eau potable, Ville de Trois-Rivières
- **Page** : https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e
- **Fichier téléchargé** : https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e/resource/d55f59ee-a9be-4f38-a78e-c13ebe3ca7b3/download/conduites-eau-potable-v3r.json
- **Licence** : CC-BY 4.0 (attribution : « Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 »)
- **Extraction** : 2026-11-24, par `npm run aqueduc:data`
- **Champs conservés** : LABEL (identifiant du tronçon), START_NODE et STOP_NODE (nœuds), DIAMETER (mm), MATERIAL (normalisé en six valeurs), INSTALLATION_YEAR, CLASSE_FONCT (normalisée en quatre classes), LENGTH__SCALED_ (m), géométrie (WGS84, 6 décimales).
- **Écartés** : 5 tronçons de classe « -Inconnu- » ; tous les autres champs.
- **Tronçons conservés** : 24137

## Seuils affichés

Seuils de `THRESHOLDS` (`src/lib/aqueduc/sim.ts`). Une valeur au-delà d'un seuil met le capteur en « alerte » ; les mesures elles-mêmes sont simulées.

Référence réglementaire : *Règlement sur la qualité de l'eau potable* du Québec, RLRQ c. Q-2, r. 40 (texte en vigueur sur LégisQuébec). Aucun numéro d'article n'est cité ci-dessous : le texte n'a pas pu être consulté pendant la rédaction (LégisQuébec et CanLII ont refusé l'accès depuis l'environnement de développement). Les rapprochements avec le règlement sont donc **à vérifier**.

| Seuil | Valeur | Nature | Commentaire |
|---|---|---|---|
| Chlore résiduel libre, minimum (`chloreMin`) | 0,2 mg/L | Valeur de démo, inspirée de la pratique | Le règlement exige un désinfectant résiduel dans l'eau distribuée ; la valeur exacte et l'endroit où elle s'applique (sortie de l'usine, réservoir ou réseau) sont à vérifier dans le texte. 0,2 mg/L est la cible que la spécification de la démo demandait. |
| Chlore résiduel, maximum (`chloreMax`) | 4,0 mg/L | Choix de démo | Pas de norme du règlement connue de nous ; valeur courante comme plafond de désinfectant (même ordre que la limite américaine de l'EPA), non vérifiée. |
| Turbidité, maximum (`turbidityMax`) | 1,0 UTN | Choix opérationnel de démo | Plus strict que la norme de turbidité de l'eau distribuée du règlement (de mémoire 5 UTN, à vérifier) ; choisi pour que la remise en eau du scénario déclenche une attention visible. |
| pH (`phMin`, `phMax`) | 6,5 à 8,5 | Choix de démo | À notre connaissance, le pH n'est pas une norme du règlement mais un objectif esthétique ou opérationnel ; 6,5-8,5 est la plage esthétique classique. Santé Canada recommande aujourd'hui une autre plage (de mémoire 7,0 à 10,5, à vérifier). |
| Pression minimale (`pressureMin`) | 2,0 bar (200 kPa) | Choix opérationnel de démo | Ce n'est pas un paramètre de qualité de l'eau : le règlement ne le couvre pas. Valeur plausible de service minimal ; l'« attention » commence sous 2,5 bar. |

Seuils d'« attention » propres à la démo (sans source) : chlore sous 0,3 mg/L, turbidité au-dessus de 0,5 UTN, pression sous 2,5 bar.
