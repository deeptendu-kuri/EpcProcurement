/** Live, isolated WP10 proof. No demo database, recipients, timers, or cloud migrations. */
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const QUERIES=[
  {label:'A',query:'line pipe',productId:'line-pipe',markets:['IN','AE']},
  {label:'B',query:'power and control cables',productId:'cables',markets:['AE']},
  {label:'C',query:'pipeline',productId:'line-pipe',markets:['IN','SA','AE','NO','MY']},
];
export function benchmarkEnv(input,root,directory,port=3018,distDir='.next-hybrid'){
  if(!Number.isInteger(port)||port<1024||port>65535||port===3007)throw new Error('Choose an isolated port, never 3007.');
  if(!/^\.next-[a-z0-9-]+$/.test(distDir))throw new Error('Choose a repository-local named Next build directory.');
  const allowed=path.resolve(root,'tmp')+path.sep,dir=path.resolve(directory);
  if(!dir.startsWith(allowed))throw new Error('Benchmark directory must be inside this repository tmp/.');
  const env={...input,NODE_ENV:'production',DATABASE_URL:'',MIGRATION_DATABASE_URL:'',RENDER:'',VERCEL:'',
    APP_URL:`http://127.0.0.1:${port}`,MVP_DATA_DIR:path.join(dir,'pglite'),MVP_NEXT_DIST_DIR:distDir,
    MVP_OFFLINE:'0',MVP_SCHEDULER:'off',MVP_DURABLE_RESEARCH:'off',MVP_FUNNEL_WORKER:'off',MVP_OUTREACH_WORKER:'off',
    MVP_RESEARCH_TRANSPORT:'off',MVP_PROSPECT_DEMO_OUTREACH:'off',MVP_LOCAL_AUTO_ENABLE:'off',DEMO_EMAIL_ENABLED:'0',
    MVP_RESEARCH_MANUAL_DRIVER:'1',NEXT_TELEMETRY_DISABLED:'1',
    DEMO_PASSWORD:randomBytes(24).toString('hex'),SESSION_SECRET:randomBytes(48).toString('hex'),RESEARCH_WORKER_SECRET:randomBytes(32).toString('hex')};
  for(const key of ['RESEND_API_KEY','RESEND_WEBHOOK_SECRET','RESEND_RECEIVING_DOMAIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
    'HUNTER_API_KEY','EMAILABLE_API_KEY','QSTASH_TOKEN','QSTASH_CURRENT_SIGNING_KEY','QSTASH_NEXT_SIGNING_KEY','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID'])env[key]='';
  for(const [key,cap] of Object.entries({MVP_MAX_SEARCH_QUERIES:8,MVP_MAX_BING_QUERIES:12,MVP_MAX_RESEARCH_PAGES:80,MVP_MAX_AI_DOCS:40,MVP_MAX_RESEARCH_AI_TOKENS:90000})){
    const n=Number(input[key]);env[key]=String(input[key]?.trim()!==''&&Number.isInteger(n)&&n>=0?Math.min(n,cap):cap);
  }
  return env;
}
const normal=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
export function benchmarkHits(rows,evidence=[]){
  const names=rows.map(r=>normal(r.name));
  const has=(...aliases)=>names.some(n=>aliases.some(a=>n.includes(normal(a))));
  // Only named, verified award quotes on the actual DEWA cycle qualify. An aggregate story is not five awardees.
  const dewa=new Set(evidence.filter(e=>e.header?.trigger?.kind==='award'&&e.sources.some(s=>s.quotes.some(q=>q.proves==='award')&&/21 contracts|3 billion/i.test(s.title+' '+s.quotes.map(q=>q.sentence).join(' '))&&/DEWA|Dubai Electricity/i.test(s.title+' '+s.quotes.map(q=>q.sentence).join(' '))&&s.quotes.some(q=>q.proves==='award'&&normal(q.sentence).includes(normal(e.header.name))))).map(e=>normal(e.header.name)));
  return {KPIL:has('KPIL','Kalpataru'),KEC:has('KEC International'),JanDeNulUAE:rows.some(r=>normal(r.name).includes('jandenul')&&r.operatingCountry==='AE'),
    DEWA5Awardees:dewa.size>=5,Tekzone:has('Tekzone'),EMCGlobal:has('EMC Global'),WestTeam:has('West-team'),Welspun:has('Welspun'),EPIC:has('East Pipes','EPIC')};
}
export function costMetrics(reservations,cache,usage){
  const searches=reservations.filter(r=>r.kind==='search');
  const billed=cache.filter(c=>c.fresh);
  const missing=billed.some(c=>!Number.isFinite(c.result?.usage?.credits));
  const uncertain=searches.some(r=>r.outcome!=='completed')||searches.length!==billed.length;
  return {tavilyRequests:searches.length,tavilyCredits:missing||uncertain?null:billed.reduce((n,c)=>n+c.result.usage.credits,0),
    groqTokens:usage.filter(r=>r.provider==='groq').reduce((n,r)=>n+Number(r.tokens_in)+Number(r.tokens_out),0),
    groqCostKnown:!usage.some(r=>r.provider==='groq'&&!r.ok),
    reads:reservations.filter(r=>r.kind==='read').reduce((n,r)=>n+Number(r.units),0),aiCalls:usage.filter(r=>r.provider==='groq').length};
}
export function releaseGate(runs){
  const rows=runs.flatMap(r=>r.rows??[]).filter(r=>!r.isSample),dated=rows.filter(r=>r.trigger&&r.trigger.kind!=='capability'&&r.trigger.date).length;
  const junk=rows.filter(r=>/^(?:United Arab Emirates|Key Players & More|World Nuclear Association|Hindustan Times|Gulf News|Reuters|Arab News|Khaleej Times|The HinduBusinessLine)$|Norconsult|VALDEL EC|market (?:report|size)|top \d+|cable laying in UAE:/i.test(r.name));
  const hits=benchmarkHits(rows,runs.flatMap(r=>r.evidence??[]));
  const checks={allThreeCompleted:runs.length===3&&runs.every(r=>r.status==='done'&&!r.error),savedBuyers:rows.length>=15,datedTriggerShare:rows.length>0&&dated/rows.length>=.6,
    benchmarkGroups:Object.values(hits).filter(Boolean).length>=7,noJunk:junk.length===0,
    tavilyCost:runs.length===3&&runs.every(r=>r.cost?.tavilyCredits!==null&&r.cost?.tavilyCredits!==undefined&&r.cost.tavilyCredits<=8),
    groqCost:runs.length===3&&runs.every(r=>r.cost?.groqCostKnown&&r.cost.groqTokens<=90000),
    tenMinutes:runs.length===3&&runs.every(r=>r.elapsedMs<=600000)};
  return {passed:Object.values(checks).every(Boolean),checks,savedBuyers:rows.length,datedTriggers:dated,datedShare:rows.length?dated/rows.length:0,hits,junk:junk.map(r=>r.name)};
}
async function ensurePortFree(port){await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error('Benchmark port occupied; no existing process was stopped.')));probe.listen(port,'127.0.0.1',()=>probe.close(resolve));});}
export async function stopBenchmarkServer(server){
  const exited=()=>server.exitCode!==null||server.signalCode!==null;
  if(!server||exited())return;
  await new Promise(resolve=>{server.once('exit',resolve);server.kill();setTimeout(resolve,5000).unref();});
  if(!exited())throw new Error('Owned benchmark server did not stop; database inspection refused.');
}
export async function runBenchmark({queries=QUERIES,distDir='.next-hybrid'}={}){
  if(!Array.isArray(queries)||!queries.length)throw new Error('At least one explicit search is required.');
  const root=fileURLToPath(new URL('..',import.meta.url)),require=createRequire(import.meta.url);process.chdir(root);
  if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
  createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(root,false,{info(){},error(){}});
  const directory=path.join(root,'tmp',`benchmark-${new Date().toISOString().slice(0,10)}-${Date.now()}`);
  const port=Number(process.env.BENCHMARK_PORT||3018),env=benchmarkEnv(process.env,root,directory,port,distDir);
  if(!env.GROQ_API_KEY||!env.TAVILY_API_KEY)throw new Error('Live benchmark requires existing Groq and Tavily keys.');
  if(!existsSync(path.join(root,distDir,'BUILD_ID')))throw new Error('Run the four safe gates before benchmarking.');
  await ensurePortFree(port);mkdirSync(directory,{recursive:true});
  const results=[],base=env.APP_URL;let server,cookie='';
  const logFile=path.join(directory,'server.log');
  const redact=value=>{let s=String(value);for(const [key,value] of Object.entries(env))if(/KEY|SECRET|PASSWORD|DATABASE_URL/.test(key)&&value&&value.length>5)s=s.split(value).join('[redacted]');return s;};
  const start=async()=>{
    server=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>appendFileSync(logFile,redact(chunk)));
    server.on('error',e=>appendFileSync(logFile,redact(e.message)));
    for(let n=0;n<90;n++){
      if(server.exitCode!==null)throw new Error('Isolated server exited; inspect server.log.');
      const response=await fetch(base+'/api/mvp/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:env.DEMO_PASSWORD}),signal:AbortSignal.timeout(3000)}).catch(()=>null);
      if(response?.ok){cookie=response.headers.get('set-cookie')?.split(';')[0]??'';if(cookie)return;}
      await new Promise(r=>setTimeout(r,1000));
    }throw new Error('Isolated server did not become ready.');
  };
  const api=async(url,options={},timeout=30000)=>{const response=await fetch(base+url,{...options,headers:{cookie,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(Math.max(1,timeout))});const json=await response.json();if(!response.ok)throw new Error(`App HTTP ${response.status}: ${json.error??'Request failed'}`);return json;};
  try{
    await start();const initial=await api('/api/mvp/runs');if(initial.runs.length)throw new Error('Refusing to benchmark a populated database.');
    for(const query of queries){
      if(!server||server.exitCode!==null)await start();
      const result={...query,status:'not_run',rows:[],evidence:[]},began=Date.now(),deadline=began+600000;results.push(result);
      console.log(`Benchmark ${query.label}: ${query.query}; email and timers OFF.`);
      try{
        const ticket=await api('/api/mvp/runs',{method:'POST',body:JSON.stringify({...query,label:undefined,researchMode:'batch',targetCompanies:10,leadKinds:['supply_subcontract']})});
        if(!ticket.runId||!ticket.ticketId?.startsWith('durable-'))throw new Error('Expected manually driven durable run.');result.runId=ticket.runId;
        while(Date.now()<deadline){
          const {run}=await api(`/api/mvp/runs/${result.runId}`,{},deadline-Date.now());result.status=run.status;result.counters=run.counters;
          if(['done','failed','cancelled'].includes(run.status))break;
          await api('/api/mvp/research/worker',{method:'POST',headers:{authorization:`Bearer ${env.RESEARCH_WORKER_SECRET}`},body:JSON.stringify({runId:result.runId})},deadline-Date.now());
        }
        if(!['done','failed','cancelled'].includes(result.status))throw new Error('10 minute deadline reached; not claimed complete.');
        for(let page=1;page<=100;page++){
          const data=await api(`/api/mvp/crm/tables?run=${result.runId}&tab=leads&showRejected=1&size=100&page=${page}`);
          result.rows.push(...data.rows);if(result.rows.length>=data.total)break;
        }
        for(const row of result.rows){result.evidence.push(await api(`/api/mvp/evidence/${row.opportunityId}`));}
      }catch(error){result.error=redact(error.message);await stopBenchmarkServer(server);server=null;}
      result.elapsedMs=Date.now()-began;writeFileSync(path.join(directory,'results.partial.json'),JSON.stringify(results,null,2));
    }
  }finally{
    await stopBenchmarkServer(server);
    // Read only the isolated database, after its owner has released the files.
    const {PGlite}=await import('@electric-sql/pglite');
    if(existsSync(env.MVP_DATA_DIR)){
      const db=new PGlite(env.MVP_DATA_DIR);
      try{for(const result of results){if(!result.runId)continue;
        const reservations=(await db.query('select kind,units,outcome from research_budget_reservations where run_id=$1',[result.runId])).rows;
        const cache=(await db.query('select c.result,(c.completed_at>=r.created_at) as fresh from research_query_cache c join runs r on r.id=c.run_id where c.run_id=$1',[result.runId])).rows;
        const usage=(await db.query('select provider,tokens_in,tokens_out,ok from llm_usage where run_id=$1',[result.runId])).rows;
        result.cost=costMetrics(reservations,cache,usage);
        result.budget=(await db.query('select budget from research_sessions where run_id=$1',[result.runId])).rows[0]?.budget;
      }}finally{await db.close();}
    }
    writeBenchmarkReport(directory,results);
  }
}
export function writeBenchmarkReport(directory,results){
    const gate=releaseGate(results);
    writeFileSync(path.join(directory,'results.json'),JSON.stringify({runs:results,gate},null,2));
    const lines=['# Hybrid sourcing live benchmark',`Date: ${new Date().toISOString()}`,'',
      'Isolation: new PGlite directory, DATABASE_URL empty, no email credentials, all workers/timers OFF. Only authenticated manual research ticks. Port 3007 untouched.',
      'Budgets below retain every lower local environment cap. A budget is a ceiling, not a yield promise. Shared 7-day cache within this fresh benchmark is reported as zero new credits only when no request was made.','',
      '| Run | Saved | Dated triggers | Duration | Status | Tavily credits | Groq tokens (recorded) |',
      '|---|---:|---:|---:|---|---:|---:|',
      ...results.map(r=>`| ${r.label} · ${r.query} | ${r.rows.length} | ${r.rows.filter(x=>x.trigger?.kind!=='capability'&&x.trigger?.date).length} | ${(r.elapsedMs/60000).toFixed(2)} min | ${r.error??r.status} | ${r.cost?.tavilyCredits??'unknown'} | ${r.cost?.groqTokens??'unknown'}${r.cost&&!r.cost.groqCostKnown?' (failed-call billing unknown)':''} |`),'',
      `Release gate: **${gate.passed?'PASS':'NOT PASSED'}**. ${gate.savedBuyers}/15 saved; ${(gate.datedShare*100).toFixed(1)}%/60% dated; ${Object.values(gate.hits).filter(Boolean).length}/9 benchmark groups; ${gate.junk.length} known junk.`,
      ...Object.entries(gate.checks).map(([key,value])=>`- ${key}: ${value?'PASS':'NOT PASSED'}`),'','## Companies found / missed',
      ...Object.entries(gate.hits).map(([key,value])=>`- ${key}: ${value?'FOUND':'MISSED'}`),'',
      'DEWA gap: the saved 21-contract aggregate article names no awardees. Only five distinct named winners with verified award quotes from that cycle count. No invented awardees or benchmark search seeds.',
      'Cost caveat: Groq records provider token usage with estimator fallback; failed requests record zero tokens and billing is unknown. Unknown cost never passes the cost gate.',
      'Junk check covers the spec deny-list and known headings; manual review is still required for semantic relevance.',
      '','## Actual saved buyers',...results.flatMap(r=>r.rows.map(x=>`- ${r.label}: ${x.name} · ${x.trigger?.kind??'no trigger'} · ${x.trigger?.date??'undated'} · ${x.operatingCountry??'country unknown'}`)),
      '','## Effective budgets',...results.map(r=>`- ${r.label}: ${JSON.stringify(r.budget??'not available')}`),''];
    writeFileSync(path.join(directory,'report.md'),lines.join('\n'));console.log(JSON.stringify({report:path.join(directory,'report.md'),gate}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runBenchmark().catch(e=>{console.error(e.message);process.exitCode=1;});
