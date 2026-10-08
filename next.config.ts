import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate proof builds do not overwrite the user's running local app.
  distDir: process.env.MVP_NEXT_DIST_DIR && /^\.next-[a-z0-9-]+$/.test(process.env.MVP_NEXT_DIST_DIR) ? process.env.MVP_NEXT_DIST_DIR : ".next",
  // PGlite loads its WASM/data files from its own package folder at runtime; don't bundle it.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "pdfjs-dist"],
  // Runtime schema-readiness checks need the registry filenames on packaged cloud functions.
  outputFileTracingIncludes: { "/*": ["./src/mvp/db/migrations/*.sql", "./src/mvp/pipeline/pdf-worker.mjs", "./node_modules/pdfjs-dist/legacy/build/*.mjs"] },
};

export default nextConfig;
