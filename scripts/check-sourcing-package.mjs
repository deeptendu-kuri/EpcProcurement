/** Run the four required package gates without touching cloud DB, port 3007, or live providers. */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const require=createRequire(import.meta.url);
const env={...process.env,DATABASE_URL:'',MIGRATION_DATABASE_URL:'',RENDER:'',VERCEL:'',
  MVP_NEXT_DIST_DIR:'.next-hybrid',MVP_DATA_DIR:path.join(root,'tmp','hybrid-validation-db'),
  MVP_SCHEDULER:'off',MVP_DURABLE_RESEARCH:'off',MVP_FUNNEL_WORKER:'off',MVP_OUTREACH_WORKER:'off',
  DEMO_EMAIL_ENABLED:'0',NEXT_TELEMETRY_DISABLED:'1'};
for(const key of ['RESEND_API_KEY','GROQ_API_KEY','TAVILY_API_KEY','HUNTER_API_KEY','EMAILABLE_API_KEY',
  'GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY',
  'QSTASH_NEXT_SIGNING_KEY','RESEARCH_WORKER_SECRET','RESEND_WEBHOOK_SECRET',
  'CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'])env[key]='';
const pnpm=path.join(path.dirname(require.resolve('pnpm',{paths:[root,path.dirname(process.execPath)]})),'bin','pnpm.cjs');
const commands=[['typecheck'],['lint'],['test','--maxWorkers=2'],['build']];
for(const args of commands){
  console.log(`\nRequired gate: pnpm ${args.join(' ')}`);
  const code=await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[pnpm,...args],{cwd:root,env,stdio:'inherit'});
    child.on('error',reject);child.on('exit',resolve);
  });
  if(code!==0){process.exitCode=Number(code)||1;break;}
}
