import { randomUUID } from 'node:crypto';
import { getDb, type Db, type Queryable } from '@/mvp/db';
import type { RunInput, RunCounters } from '@/mvp/types';
import { researchBudget } from '@/mvp/discovery/plan';
import type { RawDoc } from '@/mvp/pipeline/contracts';
import { resolveMaterial } from '@/mvp/discovery/material-catalogue';
import { DISCOVERY_VERSION,discoverySchema } from '@/mvp/discovery';
import { loadCompanyBundle } from '@/mvp/discovery/bundle';
import { feedUrls } from '@/mvp/pipeline/sources/rss';
import { readLaneLimits } from './registry';
import { queueRead } from './investigation';
import { prioritiseDiscoveryDocs } from './routing';
import { maxExtensionRounds, minimumBuyers } from './limits';
import { sourcePlan,tavilyTask } from '@/mvp/sourcing/plan';
import { junkReason } from '@/mvp/sourcing/junk';
import {SOURCING_REGISTRY} from '@/mvp/sourcing/registry';

export type ResearchBudget = ReturnType<typeof researchBudget>;
export interface ResearchJob { id:string;run_id:string;stage:'collect'|'read'|'analyse'|'finish';key:string;payload:Record<string,unknown>;state:string;attempts:number;lease_token:string|null; }
export interface ResearchSession { run_id:string;state:string;budget:ResearchBudget;generation:number;stop_reason:string|null; }
export async function addJob(tx:Queryable,runId:string,stage:ResearchJob['stage'],key:string,payload:unknown,priority=0) {
  const job=(await tx.query<{id:string}>(`insert into research_jobs(run_id,stage,key,payload,priority) values($1,$2,$3,$4::jsonb,$5)
    on conflict(run_id,stage,key) do nothing returning id`,[runId,stage,key,JSON.stringify(payload),priority])).rows[0];
  if(job)await tx.query(`insert into research_outbox(run_id,job_id,dedupe_key) values($1,$2,$3) on conflict do nothing`,[runId,job.id,`job:${job.id}:0`]);
  return job?.id??null;
}
export async function createResearchRun(input:RunInput,db:Db=getDb()):Promise<string> {
  if(!input.productId||input.offline)throw new Error('Durable research requires a live product search.');
  const material=resolveMaterial(input.query,input.productId);if(material.status!=='resolved')throw new Error(material.question??'Clarify the material before research.');
  const budget=researchBudget(input);
  return db.tx(async tx=>{
    const run=(await tx.query<{id:string}>(`insert into runs(adhoc_query,status,counters) values($1::jsonb,'queued','{}') returning id`,[JSON.stringify(input)])).rows[0];
    await tx.query('insert into research_sessions(run_id,budget) values($1,$2::jsonb)',[run.id,JSON.stringify(budget)]);
    const web=Boolean(process.env.TAVILY_API_KEY?.trim());
    const plan=sourcePlan({productId:input.productId!,keyword:input.query,markets:input.markets,mode:budget.mode,lanes:input.lanes,includeResellers:input.includeResellers});
    for(const task of plan){
      if(task.source==='tavily'&&!web)continue;
      const payload=task.source==='registry'&&task.registryId!=='dewa-contractor-list'?{source:'registry',sourcingLane:task.lane,registryId:task.registryId,market:task.market}:
        task.source==='registry'?{source:'directory-seed',sourcingLane:task.lane,raw:{sourceKey:`directory:${task.registryId}`,sourceName:'Official contractor listing',tier:'A',url:task.url,title:null,publishedAt:null,text:null,isSample:false,research:{lane:'directory',sourcingLane:task.lane,registryId:task.registryId}}}:
        task.source==='tavily'?{source:'tavily',sourcingLane:task.lane,query:tavilyTask(task)}:
        {source:task.source,sourcingLane:task.lane,market:task.market,query:task.query,...(task.material?{material:task.material,work:task.work}:{}),...(task.words?{words:task.words}:{})};
      await addJob(tx,run.id,'collect',task.id,payload,task.priority);
    }
    for(const source of SOURCING_REGISTRY.filter(s=>s.reviewRequired&&input.markets.includes(s.market)))await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'info',$2,'{}')",[run.id,`Registry coverage warning (${source.id}): ${source.note}`]);
    // Optional public feeds add coverage, never replace the trigger-first plan.
    const news=process.env.MVP_RESEARCH_NEWS==='on';
    if(news)for(const feed of feedUrls())await addJob(tx,run.id,'collect',`rss:${feed}`,{source:'rss-feed',feed},5);
    if(news)await addJob(tx,run.id,'collect','gdelt',{source:'gdelt'},10);
    await tx.query(`insert into run_events(run_id,stage,message,counters) values($1,'collect',$2,'{}')`,[run.id,`Research saved durably (${budget.mode}). Sources and available contacts are independent of email validation.`]);
    return run.id;
  });
}
/** Bridge old in-process searches/resume to the same durable hybrid stages.
 * The pages are already stored originals; no source is recollected or searched here.
 */
export async function attachStoredHybridRun(runId:string,input:RunInput,docs:RawDoc[],db:Db=getDb()) {
  const budget=researchBudget(input);
  await db.tx(async tx=>{
    await tx.query("insert into research_sessions(run_id,budget) values($1,$2::jsonb) on conflict(run_id) do nothing",[runId,JSON.stringify(budget)]);
    for(const raw of docs)await addJob(tx,runId,'read',raw.url,{raw},35);
    await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'collect','Hybrid research: award and capability analysis share this run and budget.','{}')",[runId]);
  });
}
/** Atomic per-run reservations survive retries. Unknown acceptance is never silently recharged. */
export async function reserveBudget(db:Db,runId:string,kind:string,key:string,units:number,limit:number):Promise<'reserved'|'existing'|'exhausted'> {
  if(!Number.isInteger(units)||units<0||!Number.isFinite(limit)||limit<0)throw new Error('Invalid research budget.');
  return db.tx(async tx=>{
    await tx.query('select run_id from research_sessions where run_id=$1 for update',[runId]);
    const existing=(await tx.query('select key from research_budget_reservations where run_id=$1 and kind=$2 and key=$3',[runId,kind,key])).rows;
    if(existing.length)return 'existing';
    const used=(await tx.query<{units:number}>('select coalesce(sum(units),0)::int as units from research_budget_reservations where run_id=$1 and kind=$2',[runId,kind])).rows[0].units;
    if(used+units>limit)return 'exhausted';
    await tx.query('insert into research_budget_reservations(run_id,kind,key,units) values($1,$2,$3,$4)',[runId,kind,key,units]);return 'reserved';
  });
}
export async function markBudget(db:Db,runId:string,kind:string,key:string,outcome:'completed'|'unknown') {
  await db.query('update research_budget_reservations set outcome=$4 where run_id=$1 and kind=$2 and key=$3',[runId,kind,key,outcome]);
}
/** Reserve both caps together: a failed token reservation must not consume an AI-page slot. */
/**
 * AI tokens a search has used (doc 18 §8): calls still in flight or of unknown outcome count their
 * reserved estimate; finished calls count the tokens the provider reported (llm_usage). Reservations
 * alone over-counted about 2x (9 Oct steel plates: 237,775 reserved vs 109,393 used), which stopped
 * searches at half their allowance.
 */
export async function aiTokensUsed(q:Queryable,runId:string):Promise<number> {
  const row=(await q.query<{pending:number;actual:number;completed:number}>(`select
    (select coalesce(sum(units),0) from research_budget_reservations where run_id=$1 and kind='ai_tokens' and coalesce(outcome,'')<>'completed')::int as pending,
    (select coalesce(sum(units),0) from research_budget_reservations where run_id=$1 and kind='ai_tokens' and outcome='completed')::int as completed,
    (select coalesce(sum(tokens_in+tokens_out),0) from llm_usage where run_id=$1)::int as actual`,[runId])).rows[0];
  // Without provider records (mock/offline runs) the completed estimates still count.
  return row.pending+(row.actual>0?row.actual:row.completed);
}
export async function reserveAnalysis(db:Db,runId:string,key:string,tokens:number,budget:ResearchBudget) {
  return db.tx(async tx=>{
    await tx.query('select run_id from research_sessions where run_id=$1 for update',[runId]);
    const existing=(await tx.query('select key from research_budget_reservations where run_id=$1 and kind=\'ai_pages\' and key=$2',[runId,key])).rows;
    if(existing.length)return 'existing' as const;
    const pages=(await tx.query<{units:number}>("select coalesce(sum(units),0)::int as units from research_budget_reservations where run_id=$1 and kind='ai_pages'",[runId])).rows[0].units;
    if(pages+1>budget.maxAiPages||(await aiTokensUsed(tx,runId))+tokens>budget.maxAiTokens)return 'exhausted' as const;
    await tx.query(`insert into research_budget_reservations(run_id,kind,key,units) values($1,'ai_pages',$2,1),($1,'ai_tokens',$2,$3)`,[runId,key,tokens]);return 'reserved' as const;
  });
}
export async function claimJob(db:Db=getDb(),runId?:string,jobId?:string):Promise<ResearchJob|null> {
  return db.tx(async tx=>{
    // Cancelled parent runs cannot be revived by a delayed delivery.
    await tx.query(`update research_sessions s set state='cancelled' from runs r where r.id=s.run_id and r.status='cancelled' and s.state<>'cancelled'`);
    await tx.query(`update research_jobs j set state='cancelled',lease_token=null,lease_until=null where state in ('queued','paused','running') and exists(select 1 from research_sessions s where s.run_id=j.run_id and s.state='cancelled')`);
    const token=randomUUID();
    const job=(await tx.query<ResearchJob>(`select j.* from research_jobs j join research_sessions s on s.run_id=j.run_id
      where s.state='active' and ($1::uuid is null or j.run_id=$1) and ($2::uuid is null or j.id=$2) and j.available_at<=now()
      and (j.state='queued' or j.state='running' and j.lease_until<now())
      and not exists(select 1 from research_jobs busy where busy.run_id=j.run_id and busy.state='running' and busy.lease_until>now())
      and (coalesce(j.payload->>'sourcingLane','')<>'capability' or not exists(select 1 from research_jobs earlier
        where earlier.run_id=j.run_id and earlier.id<>j.id and earlier.priority>j.priority and earlier.state in ('queued','running')))
      order by j.priority desc,j.created_at,j.id for update of j,s skip locked limit 1`,[runId??null,jobId??null])).rows[0];
    if(!job)return null;
    await tx.query(`update research_jobs set state='running',lease_token=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() where id=$1`,[job.id,token]);
    await tx.query(`update runs set status='running',started_at=coalesce(started_at,now()) where id=$1 and status<>'cancelled'`,[job.run_id]);
    return {...job,lease_token:token,attempts:job.attempts+1};
  });
}
export async function owned(tx:Queryable,job:ResearchJob):Promise<boolean> {
  return Boolean((await tx.query(`select j.id from research_jobs j join research_sessions s on s.run_id=j.run_id join runs r on r.id=j.run_id
    where j.id=$1 and j.lease_token=$2 and j.state='running' and j.lease_until>now() and s.state='active' and r.status<>'cancelled' for update of j`,[job.id,job.lease_token])).rows.length);
}
export async function completeJob(db:Db,job:ResearchJob,result:unknown,next?:{stage:ResearchJob['stage'];key:string;payload:unknown;priority?:number}[]) {
  return db.tx(async tx=>{
    if(!await owned(tx,job))return false;
    for(const n of next??[])await addJob(tx,job.run_id,n.stage,n.key,n.payload,n.priority);
    await tx.query(`update research_jobs set state='done',result=$3::jsonb,lease_token=null,lease_until=null,updated_at=now() where id=$1 and lease_token=$2`,[job.id,job.lease_token,JSON.stringify(result)]);
    return true;
  });
}
export async function parkJob(db:Db,job:ResearchJob,reason:string) {
  await db.tx(async tx=>{
    if(!await owned(tx,job))return;
    await tx.query(`update research_jobs set state='paused',error=$3,lease_token=null,lease_until=null where id=$1 and lease_token=$2`,[job.id,job.lease_token,reason]);
    await tx.query(`update research_sessions set state='partial',stop_reason=$2,updated_at=now() where run_id=$1`,[job.run_id,reason]);
    await tx.query(`update runs set status='done',finished_at=now(),error=null where id=$1 and status<>'cancelled'`,[job.run_id]);
  });
  await researchProgress(db,job.run_id,'info',`Partial research: ${reason}. Saved companies are retained; resume checks unfinished work.`);
}
export async function researchProgress(db:Db,runId:string,stage:string,message:string) {
  const counts=(await db.query<{stage:string;state:string;count:number}>(`select stage,state,count(*)::int as count from research_jobs where run_id=$1 group by stage,state`,[runId])).rows;
  const count=(s:string,t:string)=>counts.filter(c=>c.stage===s&&c.state===t).reduce((n,c)=>n+c.count,0);
  const prospects=(await db.query<{count:number}>("select count(*)::int as count from search_opportunities where run_id=$1 and qualification<>'rejected'",[runId])).rows[0].count;
  const read=(await db.query<{count:number}>(`select count(*)::int as count from research_jobs where run_id=$1 and stage='read' and state='done' and result->>'documentId' is not null`,[runId])).rows[0].count;
  const session=(await db.query<ResearchSession>('select * from research_sessions where run_id=$1',[runId])).rows[0];
  const deferredUrls=(await db.query<{count:number}>(`select coalesce(sum((result->>'deferred')::int),0)::int as count from research_jobs where run_id=$1 and stage='collect'`,[runId])).rows[0].count;
  const limited=(await db.query<{count:number}>(`select count(*)::int as count from research_jobs where run_id=$1 and result->>'domainLimited'='true'`,[runId])).rows[0].count;
  const candidates=(await db.query<{count:number;investigated:number}>("select count(*)::int as count,count(*) filter(where document_ids<>'{}')::int as investigated from research_candidates where run_id=$1",[runId])).rows[0];
  const failures=(await db.query<{reason:string;count:number}>("select result->>'failureReason' as reason,count(*)::int as count from research_jobs where run_id=$1 and result->>'unreadable'='true' group by result->>'failureReason'",[runId])).rows;
  const usage=(await db.query<{kind:string;units:number}>("select kind,sum(units)::int as units from research_budget_reservations where run_id=$1 group by kind",[runId])).rows;
  const incompleteReads=(await db.query<{count:number}>("select count(*)::int as count from research_jobs where run_id=$1 and (result->>'truncated'='true' or result->>'paginationLimited'='true')",[runId])).rows[0].count;
  const sourceGaps=(await db.query<{count:number}>("select count(*)::int as count from research_jobs where run_id=$1 and result->>'coverageWarning'='true'",[runId])).rows[0].count;
  const units=(kind:string)=>usage.find(u=>u.kind===kind)?.units??0;
  const facts=(await db.query<{kept:number;dropped:number}>(`select coalesce(sum((result->>'factsKept')::int),0)::int as kept,
    coalesce(sum((result->>'factsDropped')::int),0)::int as dropped from research_jobs where run_id=$1 and state='done'`,[runId])).rows[0];
  const counters:RunCounters={sourcesTotal:counts.filter(c=>c.stage==='collect').reduce((n,c)=>n+c.count,0),sourcesDone:count('collect','done'),sourcesFailed:count('collect','failed'),itemsRead:read,unreadablePages:count('read','done')-read+count('read','failed'),relevant:counts.filter(c=>c.stage==='analyse').reduce((n,c)=>n+c.count,0),buyerPagesChecked:count('analyse','done'),buyerAnalysisFailed:count('analyse','failed'),deferredPages:count('analyse','queued')+count('analyse','paused'),deferredUrls,scopedProspects:prospects,newLeads:prospects,coverageIncomplete:limited>0||session?.state==='partial'||counts.some(c=>c.state==='failed'||c.state==='paused'),researchState:session?.state as RunCounters['researchState'],researchStopReason:session?.stop_reason??null};
  const lanes=(await db.query<{awardArticles:number;roundups:number;roundupCompanies:number;companySites:number;pending:number}>(`select
    count(*) filter(where stage='read' and result->>'pageKind' in ('article','filing','tender_notice'))::int as "awardArticles",
    count(*) filter(where stage='analyse' and payload->>'kind'='analyse:roundup' and state='done')::int as roundups,
    coalesce(sum((result->>'seeded')::int) filter(where stage='analyse'),0)::int as "roundupCompanies",
    count(*) filter(where stage='read' and result->>'pageKind'='company_site')::int as "companySites",
    count(*) filter(where state in ('queued','running'))::int as pending from research_jobs where run_id=$1`,[runId])).rows[0];
  counters.sourcingLanes=lanes;
  counters.researchCandidates=candidates.count;counters.investigatedCompanies=candidates.investigated;
  counters.factsKept=facts.kept;counters.factsDropped=facts.dropped;
  counters.readFailures=Object.fromEntries(failures.map(f=>[f.reason??'unknown',f.count]));
  counters.researchUsage={search:units('search'),reads:units('read'),aiCalls:units('ai_pages'),estimatedAiTokens:await aiTokensUsed(db,runId),pdfPages:units('pdf_pages')};
  counters.researchUsage.bingSearches=units('bing_search');
  counters.researchUsage.websiteLookups=units('lookup');
  if(session)counters.researchLimits={search:session.budget.searchQueries,reads:session.budget.maxPages,aiCalls:session.budget.maxAiPages,estimatedAiTokens:session.budget.maxAiTokens};
  if(session)counters.researchLimits!.bingSearches=session.budget.bingQueries;
  // Extra rounds taken because fewer buyers than wanted were saved (see extend.ts).
  if(session)counters.researchRounds=(session.budget as {extensions?:number}).extensions??0;
  counters.researchRoundsMax=maxExtensionRounds();counters.minimumBuyers=minimumBuyers();
  const skipped=(await db.query<{count:number}>("select coalesce(sum(coalesce((result->>'skippedCount')::int,0)),0)::int+count(*) filter(where stage='read' and result ? 'skipped')::int as count from research_jobs where run_id=$1",[runId])).rows[0].count;
  counters.coverage={readsSkipped:limited+skipped+count('read','failed'),deferred:deferredUrls+count('analyse','paused'),reason:session?.stop_reason??(sourceGaps?'Some sources omit required contractor/award details.':null)};
  counters.coverageIncomplete=Boolean(counters.coverageIncomplete||sourceGaps||session?.stop_reason||failures.length||deferredUrls||incompleteReads||candidates.count>candidates.investigated);
  await db.tx(async tx=>{
    await tx.query('update runs set counters=$2::jsonb where id=$1',[runId,JSON.stringify(counters)]);
    await tx.query('insert into run_events(run_id,stage,message,counters) values($1,$2,$3,$4::jsonb)',[runId,stage,message.slice(0,1000),JSON.stringify(counters)]);
  });
  return counters;
}
export async function sessionFor(db:Db,runId:string) { return (await db.query<ResearchSession>('select * from research_sessions where run_id=$1',[runId])).rows[0]??null; }
/** Repair parser-only failures from exact cached company responses. No budget
 * expansion, source recollection, extra page reads or uncached provider retry. */
export async function replayCachedCompanyAnalyses(runId:string,db:Db=getDb()) {
  const jobs=(await db.query<ResearchJob>("select * from research_jobs where run_id=$1 and stage='analyse' and state='failed' and payload ? 'candidateId'",[runId])).rows;
  const eligible:string[]=[];
  for(const job of jobs){
    const bundle=await loadCompanyBundle(db,runId,String(job.payload.candidateId));if(!bundle)continue;
    const cached=(await db.query<{result:unknown}>('select result from research_bundle_cache where candidate_id=$1 and content_hash=$2 and product_id=$3 and version=$4',
      [bundle.candidate.id,bundle.hash,(await db.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[runId])).rows[0]?.adhoc_query.productId,DISCOVERY_VERSION])).rows[0];
    if(cached&&discoverySchema.safeParse(cached.result).success)eligible.push(job.id);
  }
  if(!eligible.length)throw new Error('No compatible cached company responses to replay. No provider request made.');
  return db.tx(async tx=>{
    const session=(await tx.query<ResearchSession>('select * from research_sessions where run_id=$1 for update',[runId])).rows[0];
    const run=(await tx.query<{status:string}>('select status from runs where id=$1 for update',[runId])).rows[0];
    if(session?.state!=='partial'||run?.status!=='done')throw new Error('Only settled partial research can replay cached responses.');
    if((await tx.query("select id from research_jobs where run_id=$1 and state in ('queued','running') limit 1",[runId])).rows.length)throw new Error('Research is still processing.');
    const queued=await tx.query<{id:string}>(`update research_jobs set state='queued',available_at=now(),error=null,lease_token=null,lease_until=null,
      payload=payload||'{"cacheOnly":true}'::jsonb where id=any($1::uuid[]) and state='failed' returning id`,[eligible]);
    if(!queued.rows.length)throw new Error('Cached responses were already selected for replay.');
    await tx.query("update research_sessions set state='active',generation=generation+1,stop_reason=null,updated_at=now() where run_id=$1",[runId]);
    await tx.query("update runs set status='queued',finished_at=null where id=$1",[runId]);
    for(const job of queued.rows)await tx.query("insert into research_outbox(run_id,job_id,dedupe_key) values($1,$2,$3) on conflict do nothing",[runId,job.id,`job:${job.id}:cache-replay:${session.generation+1}`]);
    return queued.rows.length;
  });
}
export async function resumeResearchRun(runId:string,db:Db=getDb()) {
  await db.tx(async tx=>{
    const session=(await tx.query<ResearchSession>('select * from research_sessions where run_id=$1 for update',[runId])).rows[0];
    if(!session||session.state!=='partial')throw new Error('Only partial durable research can resume.');
    const failed=(await tx.query("select id from research_jobs where run_id=$1 and stage='analyse' and state='failed'",[runId])).rows.length;
    if(failed)throw new Error('Failed AI analyses need provider/evidence review before another charged attempt. Saved buyers remain available.');
    // The next explicit round adds bounded AI capacity; completed queries and pages remain untouched.
    const generation=session.generation+1;const round=researchBudget((await tx.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[runId])).rows[0].adhoc_query);
    const ceiling=researchBudget({...round,query:'',markets:[],researchMode:'deep'});
    const budget={...session.budget,maxAiPages:Math.min(ceiling.maxAiPages,session.budget.maxAiPages+round.maxAiPages),maxAiTokens:Math.min(ceiling.maxAiTokens,session.budget.maxAiTokens+round.maxAiTokens),maxPages:Math.min(ceiling.maxPages,session.budget.maxPages+round.maxPages)};
    if(budget.maxAiPages<=session.budget.maxAiPages && budget.maxAiTokens<=session.budget.maxAiTokens && budget.maxPages<=session.budget.maxPages)
      throw new Error('Maximum cumulative research budget reached. Review saved results or run a narrower search; no extra credits were spent.');
    await tx.query(`update research_sessions set state='active',generation=$2,budget=$3::jsonb,stop_reason=null,updated_at=now() where run_id=$1`,[runId,generation,JSON.stringify(budget)]);
    await tx.query(`update research_jobs set state='queued',available_at=now(),error=null where run_id=$1 and state='paused'`,[runId]);
    // Re-evaluate rejected candidates from successful cached extraction after an
    // evidence-rule correction. No completed query or AI request is repeated.
    await tx.query(`update research_jobs j set state='queued',available_at=now(),error=null
      where j.run_id=$1 and j.stage='analyse' and j.state='done' and coalesce((j.result->>'invalid')::int,0)>0
      and exists(select 1 from buyer_discovery_cache c join source_documents d on d.id=c.document_id
        where c.document_id=(j.payload->>'documentId')::uuid and c.product_id=$2 and c.content_hash=d.content_hash and c.version=$3)`,
      [runId,(await tx.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[runId])).rows[0].adhoc_query.productId,DISCOVERY_VERSION]);
    // Deferred original URLs are checkpoints, not thrown away. Resume adds reads, never recollects.
    const collected=(await tx.query<{id:string;result:{docs?:RawDoc[];deferred?:number}}>('select id,result from research_jobs where run_id=$1 and stage=\'collect\' and state=\'done\'',[runId])).rows;
    const existingKeys=new Set((await tx.query<{key:string}>('select key from research_jobs where run_id=$1 and stage=\'read\'',[runId])).rows.map(r=>r.key));
    let slots=Math.max(0,budget.maxPages-existingKeys.size);
    for(const j of collected){let deferred=0;for(const raw of j.result.docs??[]){if(existingKeys.has(raw.url))continue;if(!slots){deferred++;continue;}existingKeys.add(raw.url);slots--;await addJob(tx,runId,'read',raw.url,{raw},20);}
      await tx.query('update research_jobs set result=$2::jsonb where id=$1',[j.id,JSON.stringify({...j.result,deferred})]);}
    await tx.query(`insert into research_outbox(run_id,job_id,dedupe_key) select run_id,id,'job:'||id||':resume:'||$2 from research_jobs where run_id=$1 and state='queued' on conflict do nothing`,[runId,String(generation)]);
    await tx.query(`update runs set status='queued',finished_at=null where id=$1 and status<>'cancelled'`,[runId]);
  });
  return runId;
}
export async function enqueueRawDocs(db:Db,job:ResearchJob,docs:RawDoc[],maxPages:number) {
  return db.tx(async tx=>{
    if(!await owned(tx,job))return;
    let deferred=0,admitted=0;
    const session=(await tx.query<ResearchSession>('select * from research_sessions where run_id=$1',[job.run_id])).rows[0];
    const availableQueries=(await tx.query<{count:number}>("select count(*)::int as count from research_jobs where run_id=$1 and stage='collect' and payload->>'source'='tavily' and state in ('queued','running','done')",[job.run_id])).rows[0].count;
    const fairCap=job.payload.source==='tavily'?Math.max(1,Math.ceil(readLaneLimits(maxPages).discovery/Math.max(1,Math.min(session.budget.searchQueries,availableQueries)))):maxPages;
    const input=(await tx.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[job.run_id])).rows[0].adhoc_query;
    const clean=docs.filter(raw=>!junkReason(raw.url,raw.title,input.markets));
    for(const raw of docs.filter(raw=>junkReason(raw.url,raw.title,input.markets)))await tx.query("insert into run_events(run_id,stage,message,counters) values($1,'info',$2,'{}')",[job.run_id,`skipped: ${junkReason(raw.url,raw.title,input.markets)}`]);
    const ordered=job.payload.source==='tavily'?prioritiseDiscoveryDocs(clean,input):clean;
    const existing=new Set((await tx.query<{key:string}>("select key from research_jobs where run_id=$1 and stage='read'",[job.run_id])).rows.map(r=>r.key));
    for(const raw of ordered){
      // A duplicate must not use this query's fair share or appear as deferred.
      if(existing.has(raw.url))continue;
      if(admitted>=fairCap){deferred++;continue;}
      const priority=raw.research?.sourcingLane==='trigger'?1600:raw.research?.sourcingLane==='roundup'?800:raw.research?.lane==='directory'?48:35;
      if(await queueRead(tx,job.run_id,raw,{maxPages},priority)){admitted++;existing.add(raw.url);}else deferred++;
    }
    await tx.query(`update research_jobs set state='done',result=$3::jsonb,lease_token=null,lease_until=null where id=$1 and lease_token=$2`,[job.id,job.lease_token,JSON.stringify({urls:clean.length,deferred,docs:clean,skippedCount:docs.length-clean.length})]);
  });
}

/** Reclaim empty queries' unused reading shares, never issue another search.
 * All collected URLs remain checkpoints. Lane, domain and global caps still apply.
 */
export async function admitDeferredDiscovery(db:Db,runId:string):Promise<number> {
  return db.tx(async tx=>{
    const session=(await tx.query<ResearchSession>('select * from research_sessions where run_id=$1 for update',[runId])).rows[0];
    if(!session||session.state!=='active')return 0;
    if((await tx.query("select id from research_jobs where run_id=$1 and stage='collect' and state in ('queued','running','paused') and coalesce(payload->>'sourcingLane','')<>'capability' limit 1",[runId])).rows.length)return 0;
    const input=(await tx.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[runId])).rows[0].adhoc_query;
    const sources=(await tx.query<{id:string;result:{docs?:RawDoc[];deferred?:number}}>("select id,result from research_jobs where run_id=$1 and stage='collect' and state='done' and payload->>'source'='tavily' order by priority desc,created_at,id",[runId])).rows;
    const existing=new Set((await tx.query<{key:string}>("select key from research_jobs where run_id=$1 and stage='read'",[runId])).rows.map(r=>r.key));
    const pending=sources.map(s=>({source:s,docs:prioritiseDiscoveryDocs(s.result.docs??[],input).filter(d=>!existing.has(d.url))}));
    let added=0;
    // Round-robin admission prevents one successful query swallowing the others.
    while(pending.some(p=>p.docs.length)){
      let admittedThisRound=false;
      for(const p of pending){
        const raw=p.docs.shift();if(!raw||existing.has(raw.url))continue;
        if(await queueRead(tx,runId,raw,session.budget,raw.research?.lane==='directory'?48:35)){
          existing.add(raw.url);added++;admittedThisRound=true;
        }
      }
      if(!admittedThisRound)break;
    }
    for(const s of sources){const deferred=(s.result.docs??[]).filter(d=>!existing.has(d.url)).length;
      if(deferred!==s.result.deferred)await tx.query('update research_jobs set result=$2::jsonb where id=$1',[s.id,JSON.stringify({...s.result,deferred})]);
    }
    return added;
  });
}

/**
 * Stop a running search at the user's request. Queued and paused work is cancelled; a step already
 * running finishes but its result is discarded (owned() checks the run is not cancelled). Companies and
 * buyers found so far are kept. Returns false when the search was not running.
 */
export async function cancelResearchRun(db:Db,runId:string):Promise<boolean> {
  const stopped=await db.tx(async tx=>{
    const run=(await tx.query<{id:string}>(`update runs set status='cancelled',finished_at=now(),error='Stopped by you.' where id=$1 and status in ('queued','running') returning id`,[runId])).rows[0];
    if(!run)return false;
    await tx.query(`update research_sessions set state='cancelled',stop_reason='Stopped by you.',updated_at=now() where run_id=$1 and state<>'cancelled'`,[runId]);
    await tx.query(`update research_jobs set state='cancelled',lease_token=null,lease_until=null,updated_at=now() where run_id=$1 and state in ('queued','paused','running')`,[runId]);
    return true;
  });
  if(stopped)await db.query(`insert into run_events(run_id,stage,message) values($1,'info','Search stopped by you. Companies already found are kept.')`,[runId]);
  return stopped;
}
