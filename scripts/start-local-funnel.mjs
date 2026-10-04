/** Repeatable local-only launch. Never migrates or connects to the cloud database. */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function localFunnelEnv(input, root) {
  const worker = input.MVP_FUNNEL_WORKER?.trim() || "off";
  if (!["off", "on"].includes(worker)) throw new Error("Local MVP_FUNNEL_WORKER must be off or on.");
  if ((input.SESSION_SECRET?.trim().length ?? 0) < 32)
    throw new Error("Set a stable SESSION_SECRET of at least 32 characters in the ignored local environment file.");
  return {
    ...input, NODE_ENV: "production", DATABASE_URL: "", MIGRATION_DATABASE_URL: "", RENDER: "",
    MVP_DATA_DIR: path.resolve(root, "tmp/automation-demo-db-20261003"),
    MVP_OFFLINE: "0", MVP_SCHEDULER: "off", MVP_OUTREACH_WORKER: "off", MVP_FUNNEL_WORKER: worker,
    DEMO_EMAIL_ENABLED: "1", DEMO_RECIPIENT_EMAIL: input.APPROVED_DEMO_RECIPIENT_EMAIL?.trim().toLowerCase() || "deeptendukuri@gmail.com",
    DEMO_EMAIL_FROM: `${(input.SALES_PERSON_NAME?.trim() || "Sales demo").replace(/[<>\r\n"]/g,"").slice(0,80)} | Procurement demo <onboarding@resend.dev>`, APP_URL: "http://localhost:3007",
    DEMO_PASSWORD: input.DEMO_PASSWORD?.trim() || "showcase-demo",
  };
}

export async function startLocalFunnel({ check = false } = {}) {
  const root = fileURLToPath(new URL("..", import.meta.url));
  process.chdir(root);
  const require = createRequire(import.meta.url);
  if (existsSync(".env.funnel.local")) process.loadEnvFile(".env.funnel.local");
  createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(root, false);
  const env = localFunnelEnv(process.env, root);
  if (check) {
    console.log(JSON.stringify({ localOnly: true, cloudDatabaseExcluded: !env.DATABASE_URL,
      url: env.APP_URL, dataDirectory: env.MVP_DATA_DIR, worker: env.MVP_FUNNEL_WORKER,
      noEmailSent: true, noCalendarWrites: true }, null, 2));
    return;
  }
  if (!existsSync(path.join(root, ".next/BUILD_ID"))) throw new Error("Run pnpm build before pnpm funnel:start.");
  console.log(`Local funnel: ${env.APP_URL}; cloud database excluded; background worker ${env.MVP_FUNNEL_WORKER}. App-level enablement remains separate.`);
  const server = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3007"],
    { cwd: root, stdio: "inherit", env });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => server.kill(signal));
  server.on("error", () => { console.error("Local server could not start; no cloud fallback was attempted."); process.exitCode = 1; });
  server.on("exit", code => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startLocalFunnel({ check: process.argv.includes("--check") }).catch(error => {
    console.error(error instanceof Error ? error.message : "Local startup failed."); process.exitCode = 1;
  });
}
