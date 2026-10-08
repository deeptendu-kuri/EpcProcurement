/** Operate only the existing Free demo service. Credentials are never logged or committed. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import pg from 'pg';

const targetId = 'srv-dav4k5t9fdbs73b8smp0';
const ownerId = 'tea-csproia3esus739ouc5g';
const repository = 'https://github.com/deeptendu-kuri/EpcProcurement';
const branch = 'deploy/free-cloud-demo-2026-10-08';
const local = {};
for (const file of ['.env.local', '.env.production.local', '.env.funnel.local']) {
  if (existsSync(file)) Object.assign(local, parseEnv(readFileSync(file, 'utf8')));
}
Object.assign(local, process.env);
const knownSecrets = Object.entries(local).filter(([key, value]) => /KEY|SECRET|PASSWORD|DATABASE_URL/.test(key) && value?.length > 5).map(([, value]) => value);
const redact = value => {
  let output = String(value);
  for (const secret of knownSecrets) output = output.split(secret).join('[redacted]');
  return output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, '[redacted database URL]');
};
async function api(endpoint, method = 'GET', body) {
  if (!local.RENDER_API_KEY) throw new Error('RENDER_API_KEY is not configured locally.');
  const response = await fetch(`https://api.render.com/v1${endpoint}`, { method,
    headers: { authorization: `Bearer ${local.RENDER_API_KEY}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Render ${method} ${endpoint}: HTTP ${response.status}: ${redact(JSON.stringify(result))}`);
  return result;
}
async function target() {
  const response = await api(`/services/${targetId}`);
  const service = response.service ?? response;
  if (service.ownerId !== ownerId || service.name !== 'epcprocurement-demo' || service.repo?.replace(/\.git$/, '') !== repository || service.serviceDetails?.plan !== 'free')
    throw new Error('Scope or Free-plan verification failed; no changes allowed.');
  return service;
}
async function environment() {
  const values = await api(`/services/${targetId}/env-vars?limit=100`);
  const env = Object.fromEntries(values.map(entry => { const item = entry.envVar ?? entry; return [item.key, item.value]; }));
  knownSecrets.push(...Object.entries(env).filter(([key, value]) => /KEY|SECRET|PASSWORD|DATABASE_URL/.test(key) && value?.length > 5).map(([, value]) => value));
  return env;
}
async function database(env, migrate = false) {
  if (!env.DATABASE_URL) throw new Error('The existing cloud database is missing.');
  const { migrationConnectionString, applyMigrations } = await import('./db-migrate.mjs');
  const client = new pg.Client({ connectionString: migrationConnectionString(env.DATABASE_URL), connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    if (migrate) console.log(JSON.stringify({ applied: await applyMigrations(client) }));
    const migrations = (await client.query('select name from schema_migrations order by name')).rows.map(row => row.name);
    const counts = {};
    for (const table of ['runs', 'leads', 'companies', 'search_opportunities', 'funnel_threads']) {
      if ((await client.query('select to_regclass($1) as name', [table])).rows[0].name)
        counts[table] = Number((await client.query(`select count(*) as count from ${table}`)).rows[0].count);
    }
    console.log(JSON.stringify({ cloudDatabase: true, migrationCount: migrations.length, latestMigration: migrations.at(-1), counts }));
  } finally { await client.end().catch(() => undefined); }
}
try {
  const action = process.argv[2] ?? 'status';
  const service = await target();
  console.log(JSON.stringify({ service: service.name, plan: service.serviceDetails.plan, url: service.serviceDetails.url, branch: service.branch,
    runtime: service.serviceDetails.runtime, autoDeploy: service.autoDeployTrigger ?? service.autoDeploy,
    build: service.serviceDetails.envSpecificDetails?.buildCommand, start: service.serviceDetails.envSpecificDetails?.startCommand }));
  if (action === 'audit') {
    const remote = await environment();
    console.log(JSON.stringify({ configuredKeys: Object.keys(remote).sort(), calendarReconnectRequired: true,
      approvedInbox: local.APPROVED_DEMO_RECIPIENT_EMAIL, localPasswordMatchesCloud: local.DEMO_PASSWORD === remote.DEMO_PASSWORD }));
    await database(remote);
  } else if (action === 'prepare') {
    const remote = await environment();
    if (local.APPROVED_DEMO_RECIPIENT_EMAIL !== 'hritikdebnath00@gmail.com') throw new Error('Current approved inbox does not match Hritik; refusing changes.');
    for (const key of ['TAVILY_API_KEY', 'RESEND_API_KEY', 'RESEND_RECEIVING_DOMAIN', 'GROQ_API_KEY', 'EMAILABLE_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DEMO_PASSWORD'])
      if (!local[key]?.trim()) throw new Error(`${key} is missing; refusing partial configuration.`);
    if (!remote.SESSION_SECRET || !remote.DATABASE_URL) throw new Error('Existing cloud session secret and database must be preserved.');
    mkdirSync('tmp/free-cloud-deploy', { recursive: true });
    const backup = 'tmp/free-cloud-deploy/prior-render-env.json';
    if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(remote, null, 2));
    const selected = ['TAVILY_API_KEY', 'RESEND_API_KEY', 'RESEND_RECEIVING_DOMAIN', 'GROQ_API_KEY', 'EMAILABLE_API_KEY',
      'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'DEMO_PASSWORD', 'APPROVED_DEMO_RECIPIENT_EMAIL', 'SALES_PERSON_NAME',
      'SALES_TIMEZONE', 'MEETING_DURATION_MINUTES', 'SALES_START_HOUR', 'SALES_END_HOUR', 'LLM_DAILY_TOKEN_BUDGET__GROQ'];
    const env = Object.fromEntries(selected.filter(key => local[key]?.trim()).map(key => [key, local[key].trim()]));
    Object.assign(env, { APP_URL: service.serviceDetails.url, NODE_VERSION: '24', DEMO_EMAIL_ENABLED: '1',
      DEMO_RECIPIENT_EMAIL: 'hritikdebnath00@gmail.com',
      DEMO_EMAIL_FROM: 'Procurement sales demo <onboarding@resend.dev>',
      MVP_OFFLINE: '0', MVP_FUNNEL_WORKER: 'on', MVP_PROSPECT_DEMO_OUTREACH: 'on', MVP_DEMO_PROSPECTS_PER_SEARCH: '1',
      MVP_FUNNEL_INTERVAL_MS: '60000', MVP_RESEARCH_NEWS: 'off', MVP_DURABLE_RESEARCH: 'on', MVP_RESEARCH_TRANSPORT: 'local',
      MVP_MAX_SEARCH_QUERIES: '6', MVP_MAX_RESEARCH_PAGES: '60', MVP_MAX_AI_DOCS: '12', MVP_MAX_RESEARCH_AI_TOKENS: '30000',
      EMAILABLE_DAILY_REQUEST_LIMIT: '5', MVP_SCHEDULER: 'off', MVP_OUTREACH_WORKER: 'off', MVP_LOCAL_AUTO_ENABLE: 'off' });
    await api(`/services/${targetId}`, 'PATCH', { branch, autoDeployTrigger: 'off', serviceDetails: {
      healthCheckPath: '/api/mvp/health', envSpecificDetails: {
        buildCommand: 'corepack pnpm install --frozen-lockfile && corepack pnpm build:cloud', startCommand: 'corepack pnpm start:cloud' } } });
    for (const [key, value] of Object.entries(env)) await api(`/services/${targetId}/env-vars/${encodeURIComponent(key)}`, 'PUT', { value });
    console.log(JSON.stringify({ configuredKeys: Object.keys(env), preserved: ['DATABASE_URL', 'SESSION_SECRET'], plan: 'free', branch }));
  } else if (action === 'migrate') {
    await database(await environment(), true);
  } else if (action === 'deploy') {
    if (service.branch !== branch) throw new Error('Prepare the scoped demo branch before deployment.');
    const deploy = await api(`/services/${targetId}/deploys`, 'POST', { clearCache: 'do_not_clear' });
    mkdirSync('tmp/free-cloud-deploy', { recursive: true });
    writeFileSync('tmp/free-cloud-deploy/deploy.json', JSON.stringify({ id: deploy.id, url: service.serviceDetails.url, branch }, null, 2));
    console.log(JSON.stringify({ deployId: deploy.id, status: deploy.status }));
  } else if (action === 'status') {
    const entries = await api(`/services/${targetId}/deploys?limit=3`);
    console.log(JSON.stringify({ deploys: entries.map(entry => { const deploy = entry.deploy ?? entry;
      return { id: deploy.id, status: deploy.status, commit: deploy.commit?.id, finishedAt: deploy.finishedAt }; }) }));
  } else if (action === 'logs') {
    const result = await api(`/logs?ownerId=${ownerId}&resource=${targetId}&limit=70&direction=backward`);
    console.log(redact(JSON.stringify({ logs: result.logs?.map(log => ({ timestamp: log.timestamp, message: log.message.replace(/\u001b\[[0-9;]*m/g, '') })) })));
  } else throw new Error('Unknown deployment action.');
} catch (error) { console.error(redact(error.message)); process.exitCode = 1; }
