import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Build autonome pour l'image Docker (Coolify).
  output: "standalone",
  reactStrictMode: true,
  // Les migrations SQL sont lues au démarrage par l'instrumentation.
  outputFileTracingIncludes: { "/*": ["./drizzle/**/*"] },
};

export default nextConfig;
