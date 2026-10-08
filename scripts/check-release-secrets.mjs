/** Check tracked source against locally configured credentials; report names, never values. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = {};
for (const file of ['.env.local', '.env.production.local', '.env.funnel.local'])
  if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
const credentials = Object.entries(env).filter(([key, value]) => /API_KEY|CLIENT_SECRET|SESSION_SECRET|DATABASE_URL|TOKEN/.test(key) && value.length >= 8);
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const findings = [];
for (const file of files) {
  if (!existsSync(file)) continue;
  const content = readFileSync(file).toString('utf8');
  for (const [key, value] of credentials) if (content.includes(value)) findings.push({ file, credential: key });
}
console.log(JSON.stringify({ trackedFiles: files.length, configuredCredentialsChecked: credentials.length, findings }));
if (findings.length) process.exitCode = 1;
