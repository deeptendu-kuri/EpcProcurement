/** Isolated production build; Node preserves empty env values unlike PowerShell. */
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const discovery=process.argv.includes('--discovery');
const env={...process.env,NODE_ENV:'production',DATABASE_URL:'',MIGRATION_DATABASE_URL:'',RENDER:'',VERCEL:'',
  MVP_NEXT_DIST_DIR:discovery?'.next-discovery':'.next-reliability',MVP_DATA_DIR:path.join(root,'tmp',discovery?'discovery-build-db':'reliability-build-db'),
  MVP_SCHEDULER:'off',MVP_DURABLE_RESEARCH:'off',MVP_FUNNEL_WORKER:'off',MVP_OUTREACH_WORKER:'off',DEMO_EMAIL_ENABLED:'0'};
for(const key of ['RESEND_API_KEY','GROQ_API_KEY','TAVILY_API_KEY','HUNTER_API_KEY','EMAILABLE_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY','RESEARCH_WORKER_SECRET','RESEND_WEBHOOK_SECRET','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'])env[key]='';
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'build'],{cwd:root,env,stdio:'inherit'});
child.on('error',()=>{console.error('Isolated build could not start.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
