import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome pour l'image Docker (Coolify).
  output: "standalone",
  reactStrictMode: true,
  // Les migrations SQL sont lues au démarrage par l'instrumentation.
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"], "/bench": ["./bench/results/**/*"], "/bench/results.csv": ["./bench/results/**/*"], "/maplibre/[file]": ["./node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs", "./node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs"] },
};

export default nextConfig;
