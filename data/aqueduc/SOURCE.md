# Source des données d'aqueduc

- **Jeu de données** : Conduites d'eau potable, Ville de Trois-Rivières
- **Page** : https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e
- **Fichier téléchargé** : https://www.donneesquebec.ca/recherche/dataset/7ad4ea4e-cfc5-417b-9eb8-6e7f379a8f6e/resource/d55f59ee-a9be-4f38-a78e-c13ebe3ca7b3/download/conduites-eau-potable-v3r.json
- **Licence** : CC-BY 4.0 (attribution : « Conduites : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 »)
- **Extraction** : 2026-11-24, par `npm run aqueduc:data`
- **Champs conservés** : LABEL (identifiant du tronçon), START_NODE et STOP_NODE (nœuds), DIAMETER (mm), MATERIAL (normalisé en six valeurs), INSTALLATION_YEAR, CLASSE_FONCT (normalisée en quatre classes), LENGTH__SCALED_ (m), géométrie (WGS84, 6 décimales).
- **Écartés** : 5 tronçons de classe « -Inconnu- » ; tous les autres champs.
- **Tronçons conservés** : 24137
