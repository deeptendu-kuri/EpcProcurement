import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { loadProjectEnv, migrateCloud } from "./db-migrate.mjs";

loadProjectEnv();
const missing = ["DATABASE_URL", "DEMO_PASSWORD", "SESSION_SECRET"].filter(key => !process.env[key]?.trim());
if (missing.length || (process.env.SESSION_SECRET?.trim().length ?? 0) < 32) {
  console.error(`Cloud startup requires DATABASE_URL, DEMO_PASSWORD and SESSION_SECRET (32+ characters). Missing: ${missing.join(", ") || "SESSION_SECRET is too short"}`);
  process.exitCode = 1;
} else {
  try {
    // Render Free has no pre-deploy command: migrate before starting the HTTP server.
    await migrateCloud();
    const require = createRequire(import.meta.url);
    const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "0.0.0.0", "--port", process.env.PORT || "10000"], {
      stdio: "inherit", env: { ...process.env, NODE_ENV: "production" },
    });
    for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.kill(signal));
    server.on("error", () => { console.error("The Next.js server could not start."); process.exitCode = 1; });
    server.on("exit", code => { process.exitCode = code ?? 1; });
  } catch { console.error("Cloud startup stopped: database migration failed. Check DATABASE_URL and database permissions."); process.exitCode = 1; }
}
