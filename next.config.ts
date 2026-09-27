import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite loads its WASM/data files from its own package folder at runtime; don't bundle it.
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
};

export default nextConfig;
