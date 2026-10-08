/** Local-only, read-only diagnostics. Never logs provider secrets or session cookies. */
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
if(existsSync('.env.funnel.local'))process.loadEnvFile('.env.funnel.local');
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd(),false);
const configured=key=>Boolean(process.env[key]?.trim());
console.log(JSON.stringify({configured:Object.fromEntries(['GROQ_API_KEY','TAVILY_API_KEY','RESEND_API_KEY','EMAILABLE_API_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','RESEND_RECEIVING_DOMAIN'].map(k=>[k,configured(k)])),approvedRecipient:process.env.APPROVED_DEMO_RECIPIENT_EMAIL,sellerName:process.env.SALES_PERSON_NAME,worker:process.env.MVP_FUNNEL_WORKER,prospectDemo:process.env.MVP_PROSPECT_DEMO_OUTREACH,budgets:Object.fromEntries(['MVP_MAX_SEARCH_QUERIES','MVP_MAX_RESEARCH_PAGES','MVP_MAX_AI_DOCS','MVP_MAX_RESEARCH_AI_TOKENS'].map(k=>[k,process.env[k]||null])),playwrightModule:process.env.PLAYWRIGHT_MODULE||'playwright',playwrightExecutable:process.env.PLAYWRIGHT_EXECUTABLE_PATH||null}));
try{
  const login=await fetch('http://localhost:3007/api/mvp/login',{method:'POST',headers:{'content-type':'application/json',origin:'http://localhost:3007'},body:JSON.stringify({password:process.env.DEMO_PASSWORD||'showcase-demo'}),signal:AbortSignal.timeout(20000)});
  if(!login.ok)throw Error(`Local login HTTP ${login.status}`);
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
  const status=await fetch('http://localhost:3007/api/mvp/automation',{headers:{cookie},signal:AbortSignal.timeout(20000)});
  if(!status.ok)throw Error(`Local status HTTP ${status.status}`);
  const data=await status.json();
  console.log(JSON.stringify({localApp:data.settings,threads:data.threads.map(t=>({id:t.id,company:t.company,product:t.product,state:t.state,paused:t.paused,mode:t.mode,runId:t.run_id,reason:t.reason,meetingBooked:Boolean(t.meet_url)}))}));
  const runArg=process.argv.find(a=>a.startsWith('--run='));
  if(runArg){
    const runId=runArg.slice(6);if(!/^[a-f0-9-]{36}$/.test(runId))throw Error('Invalid run ID');
    const r=await fetch('http://localhost:3007/api/mvp/runs/'+runId,{headers:{cookie}});if(!r.ok)throw Error(`Run HTTP ${r.status}`);
    const {run}=await r.json();console.log(JSON.stringify({runId,status:run.status,counters:run.counters,events:run.events?.slice(-15)}));
    if(process.argv.includes('--research')){
      const research=await fetch('http://localhost:3007/api/mvp/research/'+runId,{headers:{cookie}});if(!research.ok)throw Error(`Research HTTP ${research.status}`);
      const details=await research.json();console.log(JSON.stringify({research:runId,candidates:details.candidates,jobs:details.jobs.filter(j=>j.stage==='analyse'||j.state==='failed'),usage:details.usage,documents:details.documents.map(d=>({id:d.id,url:d.url,title:d.title,text:d.text?.slice(0,15000)}))}));
    }
  }
  if(process.argv.includes('--pause-existing')){
    if(data.settings.recipient!=='hritikdebnath00@gmail.com')throw Error('Unexpected approved recipient; no control writes performed.');
    const post=async body=>{
      const response=await fetch('http://localhost:3007/api/mvp/automation',{method:'POST',headers:{cookie,origin:'http://localhost:3007','content-type':'application/json'},body:JSON.stringify(body)});
      if(!response.ok)throw Error(`Control HTTP ${response.status}`);
    };
    await post({action:'disable'});
    for(const t of data.threads)if(!t.paused&&!['stopped','meeting_booked'].includes(t.state))await post({action:'pause',threadId:t.id});
    console.log(JSON.stringify({automationDisabled:true,existingDemoThreadsPaused:true,reason:'Prevent old conversations sending during the new supervised test; history preserved.'}));
  }
}catch(e){console.log(JSON.stringify({localAppError:e.message}));}
