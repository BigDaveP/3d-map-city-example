# Source des données du territoire

## Zones de stationnement de nuit (réelles)

- **Jeu de données** : Stationnement de nuit, Ville de Trois-Rivières
- **Page** : https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97
- **Fichier téléchargé** : https://www.donneesquebec.ca/recherche/dataset/63037f5c-f592-4538-89b2-8a850e758b97/resource/2fcc9586-1ac7-4501-a310-ad2e7c2bf5c4/download/stationnement-nuit-v3r.json
- **Licence** : CC-BY 4.0 (attribution : « Zones de stationnement de nuit : Ville de Trois-Rivières, Données Québec, CC-BY 4.0 »)
- **Extraction** : 2026-11-25, par `npm run territoire:data`
- **Champs conservés** : V_DetailZone (« Zone A », « Zone B », « Zone C »), géométrie (WGS84, arrondie à 5 décimales). Tous les autres champs sont écartés.

## Feux d'interdiction (simulés)

Feux d'interdiction : simulation inspirée du système de la Ville de Québec ; Trois-Rivières n'en a pas à notre connaissance.

- **Génération** : nœuds des conduites d'amenée et maîtresses du réseau d'aqueduc (`data/aqueduc/trois-rivieres.json`) situés dans chaque zone, gardés seulement à plus de 250 m des feux déjà gardés ; l'écart minimal monte par pas de 50 m dans une zone qui dépasserait 200 feux (écart retenu : A 250 m, B 250 m, C 350 m). Les grandes rues suivent les conduites maîtresses.
- **Complément** : si une zone a moins de 20 feux, nœuds de distribution à plus de 400 m des feux déjà gardés.
- **Résultat** : A : 102 feux (102 sur les conduites principales) ; B : 154 feux (154 sur les conduites principales) ; C : 171 feux (171 sur les conduites principales).
- Les positions sont simulées : elles ne correspondent à aucun équipement réel.
