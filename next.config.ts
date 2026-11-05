import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  cacheComponents: true,
  turbopack: { resolveAlias: { "@/db": "./db/node.ts" } },
};

export default nextConfig;
