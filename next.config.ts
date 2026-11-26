import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome pour l'image Docker (Coolify).
  output: "standalone",
  reactStrictMode: true,
  // Fichiers lus à l'exécution : réseau (data/aqueduc), zones et feux du déneigement (data/territoire),
  // résultats du banc, worker de MapLibre. « /* » vaut pour toutes les routes (picomatch, contains).
  outputFileTracingIncludes: { "/*": ["./data/aqueduc/**/*", "./data/territoire/**/*"], "/bench": ["./bench/results/**/*"], "/bench/aqueduc.csv": ["./bench/results/**/*"], "/maplibre/[file]": ["./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "./node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"] },
};

export default nextConfig;
