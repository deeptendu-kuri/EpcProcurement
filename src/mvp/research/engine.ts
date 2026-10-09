import { getDb, type Db } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import { getClientProfile } from '@/mvp/config/profile';
import { buyerPageCandidate, buyerResearchPriority } from '@/mvp/discovery/plan';
import { discoverBuyers, saveBuyer, DISCOVERY_VERSION } from '@/mvp/discovery';
import type { RawDoc, Source, SourceContext } from '@/mvp/pipeline/contracts';
import { fetchPageText, storeDocument } from '@/mvp/pipeline/read';
import { publisherKeyFor } from '@/mvp/pipeline/text';
import { queryTerms } from '@/mvp/pipeline/filter';
import { bingNewsSource } from '@/mvp/pipeline/sources/bing-news';
import { gdeltSource } from '@/mvp/pipeline/sources/gdelt';
import { rssSource } from '@/mvp/pipeline/sources/rss';
import { cachedTavilyQuery,collectTavilyQuery } from '@/mvp/pipeline/sources/tavily';
import { collectBingQuery,collectRssFeed } from './sources';
import type { ResearchBudget } from './store';
import { admitDeferredDiscovery,completeJob,claimJob,enqueueRawDocs,markBudget,owned,parkJob,researchProgress,reserveAnalysis,reserveBudget,sessionFor } from './store';
import { candidateForPage, candidatePageIdentity, extendInvestigation, seedInvestigations, domainOf, queueRead } from './investigation';
import { RESEARCH_SOURCES } from './registry';
import { bundlePromptText,discoverCompanyBundle,loadCompanyBundle } from '@/mvp/discovery/bundle';
import { z } from 'zod';
import {groundedCompanyBuyer} from '@/mvp/discovery/grounded';
import { classifyPage,EXTRACTOR_PRIORITY } from '@/mvp/sourcing/classify';
import { junkReason } from '@/mvp/sourcing/junk';
import { extractDocument } from '@/mvp/pipeline/extract';
import { resolveDocument } from '@/mvp/pipeline/resolve';
import { detectMarkets } from '@/mvp/pipeline/filter';
import { buildSignalsAndScore } from '@/mvp/scoring';
import { captureOpportunities } from '@/mvp/opportunities';
import { awardTriggerSnapshots, budgetedAwardProviders, capabilityTriggerSnapshots } from '@/mvp/sourcing/hybrid';
import {persistAwardTriggers} from '@/mvp/sourcing/triggers';
import {persistRoundupAwards} from '@/mvp/sourcing/roundup-triggers';
import { extendResearchIfShort,retryAfterRateLimit } from './extend';
import { REPEAT_STORY_PRIORITY,sameStory } from '@/mvp/sourcing/story';
import { LLMHttpError,QuotaExceededError } from '@/mvp/llm/types';
import { tedSource } from '@/mvp/pipeline/sources/ted';
import { extractRoundup,verifyRoundup,seedRoundup,lookupRoundupWebsite } from '@/mvp/sourcing/roundup';
import { rateCandidates } from './shortlist';
import {SOURCING_REGISTRY,collectRegistry,registryPageTargets,registryReadWarning,registryRaw} from '@/mvp/sourcing/registry';

export interface ResearchDeps {
  collect(source:string,ctx:SourceContext,payload:Record<string,unknown>):Promise<RawDoc[]>;
  read:typeof fetchPageText; discover:typeof discoverBuyers; save:typeof saveBuyer;
  discoverBundle?:typeof discoverCompanyBundle;
  /** Injectable for fixture proofs; production still uses the existing P1/P2/P3 extractor. */
  extractAward?:typeof extractDocument;
  extractRoundup?:typeof extractRoundup;
  lookupWebsite?:typeof collectTavilyQuery;
}
export const productionResearchDeps:ResearchDeps={
  async collect(source,ctx,payload){
    if(source==='registry'){
      const entry=SOURCING_REGISTRY.find(s=>s.id===payload.registryId);if(!entry)throw new Error('Unknown public registry.');
      return collectRegistry(entry,ctx.input);
    }
    if(source==='directory-seed')return [payload.raw as RawDoc];
    if(source==='tavily')return collectTavilyQuery(ctx,payload.query as Parameters<typeof collectTavilyQuery>[1]);
    if(source==='bing-query')return collectBingQuery(ctx,String(payload.market),String(payload.query));
    if(source==='rss-feed')return collectRssFeed(ctx,String(payload.feed));
    if(source==='ted')return tedSource.collect({...ctx,input:{...ctx.input,markets:[String(payload.market)]}});
    const sources:Record<string,Source>={'bing-news':bingNewsSource,gdelt:gdeltSource,rss:rssSource};
    if(!sources[source])throw new Error('Unsupported research source.');
    return sources[source].collect(ctx);
  },read:fetchPageText,discover:discoverBuyers,save:saveBuyer,
};
export async function processResearchTick(db:Db=getDb(),deps:ResearchDeps=productionResearchDeps,runId?:string,jobId?:string) {
  const job=await claimJob(db,runId,jobId);
  if(!job){await finishIdleResearch(db,runId);return {processed:false};}
  const session=await sessionFor(db,job.run_id);
  const input=(await db.query<{adhoc_query:RunInput}>('select adhoc_query from runs where id=$1',[job.run_id])).rows[0].adhoc_query;
  if(!session)return {processed:false};
  try{
    if(job.stage==='collect'){
      const ctx:SourceContext={db,runId:job.run_id,input,profile:getClientProfile(),terms:queryTerms(input.query),log:m=>researchProgress(db,job.run_id,'info',m).then(()=>undefined)};
      const source=String(job.payload.source);let docs:RawDoc[];
      if(source==='roundup-website'){
        const result=await lookupRoundupWebsite(db,job.run_id,input,String(job.payload.candidateId),session.budget,
          deps.lookupWebsite??((ctx,query)=>deps.collect('tavily',ctx,{query})));
        await completeJob(db,job,result);await finishIdleResearch(db,job.run_id);return {processed:true};
      }
      if(job.payload.sourcingLane==='capability'){
        const saved=(await db.query<{count:number}>("select count(*)::int as count from search_opportunities where run_id=$1 and qualification<>'rejected'",[job.run_id])).rows[0].count;
        if(saved>=session.budget.targetCompanies){await completeJob(db,job,{skipped:'capability fallback not needed'});return {processed:true};}
      }
      if(source==='bing-query'){
        const reservation=await reserveBudget(db,job.run_id,'bing_search',job.key,1,session.budget.bingQueries);
        if(reservation!=='reserved'){
          await completeJob(db,job,{skipped:'Bing query budget',budgetLimited:true});
          await researchProgress(db,job.run_id,'info','Bing coverage limit reached; remaining sources and saved pages continue.');return {processed:true};
        }
      }
      if(source==='tavily'){
        const q=job.payload.query as Parameters<typeof collectTavilyQuery>[1];
        const cached=await cachedTavilyQuery(ctx,q);
        if(cached!==null)docs=cached;
        else{
          const reservation=await reserveBudget(db,job.run_id,'search',job.key,1,session.budget.searchQueries);
          if(reservation==='exhausted'){
            await completeJob(db,job,{skipped:'Tavily query budget',budgetLimited:true});
            await researchProgress(db,job.run_id,'info','Tavily coverage limit reached; saved pages and free sources continue.');return {processed:true};
          }
          if(reservation==='existing'){await parkJob(db,job,'A previous search request has no committed response; manual review is required before repeating a charged query.');return {processed:true,paused:true};}
          try{docs=await deps.collect(source,ctx,job.payload);await markBudget(db,job.run_id,'search',job.key,'completed');}
          catch(error){await markBudget(db,job.run_id,'search',job.key,'unknown');throw error;}
        }
      }else docs=await deps.collect(source,ctx,job.payload);
      if(source==='bing-query')await markBudget(db,job.run_id,'bing_search',job.key,'completed');
      if(job.payload.sourcingLane)docs=docs.map(raw=>({...raw,research:{lane:job.payload.sourcingLane==='trigger'?'news':job.payload.sourcingLane==='roundup'?'directory':'company',...raw.research,sourcingLane:job.payload.sourcingLane as 'trigger'|'roundup'|'capability'}}));
      await enqueueRawDocs(db,job,docs,session.budget.maxPages);
      await researchProgress(db,job.run_id,'collect',`${source}: ${docs.length} original-page candidates. Discovery is saved; contact validation is separate.`);
    }else if(job.stage==='read'){
      const raw=job.payload.raw as RawDoc;
      const junk=junkReason(raw.url,raw.title,input.markets);
      if(junk){await completeJob(db,job,{skipped:junk});await researchProgress(db,job.run_id,'info',`skipped: ${junk}`);return {processed:true};}
      const domain=await reserveBudget(db,job.run_id,`domain:${new URL(raw.url).hostname}`,job.key,1,session.budget.maxPagesPerDomain);
      if(domain==='exhausted'){
        await completeJob(db,job,{domainLimited:true});await researchProgress(db,job.run_id,'info','A page was not read because this domain reached its bounded coverage limit.');return {processed:true};
      }
      const reservation=await reserveBudget(db,job.run_id,'read',job.key,1,session.budget.maxPages);
      if(reservation==='exhausted'){await completeJob(db,job,{budgetLimited:true,skipped:'Page-read budget exhausted.'});await finishIdleResearch(db,job.run_id);return {processed:true,budgetLimited:true};}
      let text=raw.text,title=raw.title,publishedAt=raw.publishedAt;
      let links:{url:string;text:string}[]=[];let tables:string[][][]=[];let format='html';let truncated=false;let pdfPages=0;let finalUrl=raw.url;
      if(!text){
        const used=(await db.query<{units:number}>("select coalesce(sum(units),0)::int as units from research_budget_reservations where run_id=$1 and kind='pdf_pages'",[job.run_id])).rows[0].units;
        const page=await deps.read(raw.url,{fullPage:true,maxPdfPages:Math.max(0,Math.min(10,20-used)),allowUrl:url=>!junkReason(url,null,input.markets)});
        if(!page.ok){
          const warning=raw.research?.registryId?registryReadWarning(raw.research.registryId,page.reason,page.detail):{};
          await completeJob(db,job,{unreadable:true,failureReason:page.reason,...warning});await markBudget(db,job.run_id,'read',job.key,'completed');
          if('requiresManualFetch' in warning&&warning.requiresManualFetch)await researchProgress(db,job.run_id,'info',`Registry ${raw.research?.registryId}: HTTP 403 requiresManualFetch. No access-control bypass was attempted.`);
          if(raw.research?.candidateId)await db.query("update research_candidates set state='unreadable',reason=$2 where id=$1 and run_id=$3",[raw.research.candidateId,`Website read failed (${page.reason}); company research retained.`,job.run_id]);
          await researchProgress(db,job.run_id,'read',`Source read failed (${page.reason}); no invented content substituted.`);return {processed:true};
        }
        text=page.title&&!page.text.includes(page.title)?`${page.title}\n${page.text}`:page.text;title=page.title??title;publishedAt=page.publishedAt??publishedAt;
        links=page.links??[];tables=page.tables??[];format=page.format??'html';truncated=Boolean(page.truncated);pdfPages=page.pages?.length??0;finalUrl=page.finalUrl??raw.url;
        if(pdfPages){await reserveBudget(db,job.run_id,'pdf_pages',job.key,pdfPages,20);await markBudget(db,job.run_id,'pdf_pages',job.key,'completed');}
      }
      // storeDocument deduplicates content/URL; all later quotes retain the stored original's provenance.
      const stored=await storeDocument(db,job.run_id,{...raw,url:finalUrl,text,title,publishedAt,publisherKey:raw.publisherKey??publisherKeyFor(finalUrl)});
      await db.query('insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing',[job.run_id,stored.id]);
      const original=(await db.query<{url:string;title:string|null;source_key:string;source_name:string;tier:RawDoc['tier'];published_at:string|null;is_sample:boolean}>('select url,title,source_key,source_name,tier,published_at,is_sample from source_documents where id=$1',[stored.id])).rows[0];
      const grounded:RawDoc={...raw,url:original.url,title:original.title,text:stored.text,publishedAt:original.published_at,sourceKey:original.source_key,sourceName:original.source_name,tier:original.tier,isSample:original.is_sample};
      const pageKind=classifyPage({url:grounded.url,title:grounded.title,text:stored.text,tables,registryId:raw.research?.registryId,markets:input.markets});
      grounded.research={...grounded.research,lane:grounded.research?.lane??'company',pageKind};
      const list=pageKind==='roundup'||pageKind==='directory';
      const candidate=pageKind!=='junk'&&!list&&buyerPageCandidate(stored.text,input.productId!)&&!/\/(?:jobs?|careers)(?:[/-]|$)/i.test(new URL(grounded.url).pathname);
      const award=Boolean(raw.structured)||candidate&&['article','tender_notice','filing'].includes(pageKind);
      let associated=award||list?null:await candidateForPage(db,job.run_id,grounded);
      if(pageKind!=='junk'&&!list&&!award&&!associated){
        const seeded=await seedInvestigations(db,job.run_id,input,stored.id,grounded,stored.text,title,session.budget);
        if(seeded.seeds)await researchProgress(db,job.run_id,'info',`${seeded.seeds} company research seeds; ${seeded.queued} website investigations. Seeds are not qualified buyers.`);
        if(seeded.ownName)associated=await candidateForPage(db,job.run_id,grounded);
      }
      const scoped=associated?await extendInvestigation(db,job.run_id,associated,grounded,stored.id,stored.text,links,input,session.budget):false;
      // A looked-up website that never names the company is not its website: clear the guess and say so.
      if(associated&&raw.research?.candidateId&&!scoped&&pageKind!=='junk'&&!associated.document_ids.length
        &&associated.domain_hint===domainOf(grounded.url)&&!candidatePageIdentity(associated,stored.text))
        await db.query("update research_candidates set state='review',domain_hint=null,reason='Website not confirmed: the page read does not name this company.',updated_at=now() where id=$1 and run_id=$2",[associated.id,job.run_id]);
      let paginationLimited=false;
      if(raw.research?.registryId){
        const entry=RESEARCH_SOURCES.find(s=>s.id===raw.research?.registryId);
        const source=SOURCING_REGISTRY.find(s=>s.id===raw.research?.registryId);
        if(source){
          const used=(await db.query<{count:number}>("select count(*)::int as count from research_jobs where run_id=$1 and stage='read' and payload->'raw'->'research'->>'registryId'=$2",[job.run_id,source.id])).rows[0].count;
          const targets=registryPageTargets(source,links,input);
          for(const target of targets.slice(0,Math.max(0,source.maxPages-used)))if(!await db.tx(tx=>queueRead(tx,job.run_id,registryRaw(source,target.url,target.text),session.budget,EXTRACTOR_PRIORITY.roundup)))paginationLimited=true;
          if(targets.length>Math.max(0,source.maxPages-used))paginationLimited=true;
        }
        const next=links.find(l=>/^(?:next|next page|›|→)$/i.test(l.text.trim())&&domainOf(l.url)===domainOf(raw.url));
        const showing=stored.text.match(/showing\s+(\d+)\s+to\s+(\d+)\s+of\s+([\d,]+)/i);
        const hasMore=Boolean(showing&&Number(showing[2])<Number(showing[3].replace(/,/g,'')));
        if(next&&entry){
          const pages=(await db.query<{count:number}>("select count(*)::int as count from research_jobs where run_id=$1 and stage='read' and payload->'raw'->'research'->>'registryId'=$2",[job.run_id,entry.id])).rows[0].count;
          if(pages<entry.maxPages){paginationLimited=!await db.tx(tx=>queueRead(tx,job.run_id,{...raw,url:next.url,text:null,title:null},session.budget,48));}
          else paginationLimited=true;
        }else if(hasMore)paginationLimited=true;
        if(paginationLimited)await researchProgress(db,job.run_id,'info','Directory coverage incomplete: its next page is unavailable or beyond the declared limit. Parsed rows are retained; no fake pagination.');
      }
      // The persisted stage stays 'analyse' for compatibility with migration 019;
      // the explicit subtype is analyse:award. WP5 adds the trigger table, not a second run.
      // Another outlet's copy of a story already queued is analysed after lists and company pages.
      const repeat=award&&!raw.structured&&(await db.query<{title:string|null}>("select payload->'raw'->>'title' as title from research_jobs where run_id=$1 and stage='analyse' and payload->>'kind'='analyse:award'",[job.run_id])).rows.some(r=>sameStory(r.title,grounded.title));
      const next:Parameters<typeof completeJob>[3]=list?
        [{stage:'analyse',key:`roundup:${stored.id}`,payload:{kind:'analyse:roundup',documentId:stored.id,raw:grounded},priority:EXTRACTOR_PRIORITY[pageKind]}]:award?
        [{stage:'analyse',key:`award:${stored.id}`,payload:{kind:'analyse:award',documentId:stored.id,raw:grounded},priority:repeat?REPEAT_STORY_PRIORITY:EXTRACTOR_PRIORITY[pageKind]}]:
        candidate&&!scoped&&raw.research?.lane!=='directory'?[{stage:'analyse',key:stored.id,payload:{documentId:stored.id,raw:grounded},priority:buyerResearchPriority(grounded,stored.text,input)}]:[];
      await completeJob(db,job,{documentId:stored.id,candidate,award,pageKind,format,truncated,pdfPages,paginationLimited,requestedUrl:raw.url,finalUrl},next);
      await markBudget(db,job.run_id,'read',job.key,'completed');
      await researchProgress(db,job.run_id,'read',`Original page saved${candidate?' for company/material analysis':''}.`);
    }else if(job.stage==='analyse'){
      if(job.payload.kind==='analyse:roundup'){
        const id=String(job.payload.documentId);
        const doc=(await db.query<{id:string;text:string}>('select id,text from source_documents where id=$1',[id])).rows[0];
        if(!doc?.text)throw new Error('Saved roundup original unavailable.');
        const previous=(await db.query<{result:{roundup?:Awaited<ReturnType<typeof extractRoundup>>}|null}>('select result from research_jobs where id=$1',[job.id])).rows[0]?.result?.roundup;
        const providers=budgetedAwardProviders(db,job.run_id,id,session.budget);
        const roundup=previous?verifyRoundup(previous,doc.text,id):await (deps.extractRoundup??extractRoundup)(doc,providers.provider('extract_a','openai/gpt-oss-120b'));
        if(!await db.tx(tx=>owned(tx,job)))return {processed:true,stale:true};
        await db.query('update research_jobs set result=$3::jsonb where id=$1 and lease_token=$2',[job.id,job.lease_token,JSON.stringify({roundup})]);
        const seeded=await seedRoundup(db,job.run_id,input,roundup,session.budget);
        // Rate the names just found so website lookups go to likely buyers first (docs/mvp/18 §5).
        const rating=await rateCandidates(db,job.run_id,input,key=>budgetedAwardProviders(db,job.run_id,key,session.budget).provider('triage'))
          .catch(error=>({rated:[],aiCalls:0,warning:`Shortlist rating skipped: ${error instanceof Error?error.message:'error'}`}));
        const likely=rating.rated.filter(r=>r.rating>=45).length;
        if(rating.rated.length)await researchProgress(db,job.run_id,'check',`Shortlist: rated ${rating.rated.length} companies; ${likely} look like buyers. Checking the best rated first.`);
        if(rating.warning)await researchProgress(db,job.run_id,'info',rating.warning);
        await persistRoundupAwards(db,job.run_id,input,roundup);
        await completeJob(db,job,{roundup,...seeded,budgetLimited:providers.limited,coverageWarning:roundup.warnings.length>0});
        await researchProgress(db,job.run_id,'check',`Roundup: ${seeded.seeded} verified identity candidates; ${seeded.queued} website reads and ${seeded.lookups} bounded lookup tasks. Candidates are not confirmed buyers.`);
        for(const warning of roundup.warnings)await researchProgress(db,job.run_id,'info',warning);
        await finishIdleResearch(db,job.run_id);return {processed:true,runId:job.run_id};
      }
      if(job.payload.kind==='analyse:award'){
        const id=String(job.payload.documentId),raw=job.payload.raw as RawDoc;
        const doc=(await db.query<{text:string;url:string;published_at:string|null}>('select text,url,published_at from source_documents where id=$1',[id])).rows[0];
        if(!doc?.text||doc.url!==raw.url)throw new Error('Saved award original is unavailable.');
        // A stored response is a recovery checkpoint: resolution can be replayed without another paid call.
        const previous=(await db.query<{result:{extracted?:Awaited<ReturnType<typeof extractDocument>>}|null}>('select result from research_jobs where id=$1',[job.id])).rows[0]?.result;
        const providers=budgetedAwardProviders(db,job.run_id,id,session.budget);
        const extracted=previous?.extracted??await (deps.extractAward??extractDocument)(
          {text:doc.text,url:doc.url,publishedAt:doc.published_at,structured:raw.structured},
          {db,runId:job.run_id,provider:providers.provider,singleAttempt:true,onNote:m=>researchProgress(db,job.run_id,'info',m).then(()=>undefined)});
        await db.query('update research_jobs set result=$3::jsonb where id=$1 and lease_token=$2',[job.id,job.lease_token,JSON.stringify({extracted})]);
        const resolved=await db.tx(async tx=>{
          if(!await owned(tx,job))return false;
          await resolveDocument(tx,{documentId:id,url:doc.url,tier:raw.tier,publisherKey:raw.publisherKey??publisherKeyFor(doc.url),
            market:raw.market??detectMarkets(doc.text,input.markets).find(m=>input.markets.includes(m))??null,publishedAt:doc.published_at,text:doc.text},extracted);
          return true;
        });
        if(!resolved)return {processed:true,stale:true};
        const triggers=await persistAwardTriggers(db,job.run_id,input.productId!,await awardTriggerSnapshots(db,id));
        await buildSignalsAndScore(job.run_id,{db});
        await captureOpportunities(job.run_id,input,db);
        await completeJob(db,job,{extracted,triggers,factsKept:extracted.stats.kept,factsDropped:extracted.stats.dropped,budgetLimited:providers.limited});
        await researchProgress(db,job.run_id,'check',`Award analysis: ${triggers.length} verified triggers; ${extracted.stats.kept} facts kept, ${extracted.stats.dropped} quotes dropped.${providers.limited?' Shared AI coverage limit; rules-only facts retained.':''}`);
        await finishIdleResearch(db,job.run_id);return {processed:true,runId:job.run_id};
      }
      if(job.payload.candidateId){
        const bundle=await loadCompanyBundle(db,job.run_id,String(job.payload.candidateId));
        if(!bundle){await completeJob(db,job,{invalid:1,saved:0});return {processed:true};}
        const key=`bundle:v${DISCOVERY_VERSION}:${bundle.candidate.id}:${bundle.hash}`;
        const grounded=deps.discoverBundle?null:groundedCompanyBuyer(bundle,input);
        const cached=(await db.query('select candidate_id from research_bundle_cache where candidate_id=$1 and content_hash=$2 and product_id=$3 and version=$4',[bundle.candidate.id,bundle.hash,input.productId,DISCOVERY_VERSION])).rows.length>0;
        if(job.payload.cacheOnly&&!cached)throw new Error('Reviewed original response changed; no new AI request made.');
        if(!cached&&!grounded){
          const estimate=Math.ceil(JSON.stringify(bundlePromptText(bundle,input.productId!)).length/4)+1600;
          const reserve=await reserveAnalysis(db,job.run_id,key,estimate,session.budget);
          if(reserve==='exhausted'){await completeJob(db,job,{budgetLimited:true,skipped:'AI analysis budget exhausted; original company research is retained.'});await finishIdleResearch(db,job.run_id);return {processed:true,budgetLimited:true};}
          if(reserve==='existing'&&job.attempts>1){await parkJob(db,job,'Prior bundle AI acceptance is uncertain; review before another charged request.');return {processed:true,paused:true};}
        }
        const result=grounded?{buyers:[grounded],invalid:0,cached:false,rejections:[]}:deps.discoverBundle
          ?await deps.discoverBundle(db,job.run_id,input,bundle):await discoverCompanyBundle(db,job.run_id,input,bundle,Boolean(job.payload.cacheOnly));let saved=0;
        if(!cached&&!grounded){await markBudget(db,job.run_id,'ai_pages',key,'completed');await markBudget(db,job.run_id,'ai_tokens',key,'completed');}
        for(const buyer of result.buyers){
          const anchor=bundle.documents.find(d=>domainOf(d.url)===bundle.candidate.domain_hint)??bundle.documents[0];
          const raw:RawDoc={sourceKey:'company-investigation',sourceName:buyer.company,tier:anchor.tier,url:anchor.url,title:null,publishedAt:null,text:anchor.text,isSample:false};
          if(await deps.save(db,job.run_id,input,anchor.id,raw,buyer,bundle,grounded?'rule:company-application':undefined))saved++;
        }
        await db.query('update research_candidates set state=$2,reason=$3,updated_at=now() where id=$1',[bundle.candidate.id,result.buyers.length?'qualified':'review',result.rejections[0]??(result.buyers.length?'Source-backed consuming work; purchasing and contacts are separate.':'No material-consuming work established in the read pages.')]);
        const triggers=await capabilityTriggerSnapshots(db,job.run_id,input.productId!,bundle.documents.map(d=>d.id));
        await completeJob(db,job,{saved,invalid:result.invalid,cached:result.cached,deterministic:Boolean(grounded),triggers});
        await researchProgress(db,job.run_id,'check',`${result.buyers.length} company bundles qualified; ${saved} newly saved.`);
        for(const reason of result.rejections.slice(0,3))await researchProgress(db,job.run_id,'info',`Company review: ${reason}`);
        await finishIdleResearch(db,job.run_id);return {processed:true,runId:job.run_id};
      }
      const id=String(job.payload.documentId);const raw=job.payload.raw as RawDoc;
      const doc=(await db.query<{id:string;text:string;content_hash:string}>('select id,text,content_hash from source_documents where id=$1',[id])).rows[0];
      if(!doc)throw new Error('Saved original source is unavailable.');
      const cached=(await db.query('select document_id from buyer_discovery_cache where document_id=$1 and product_id=$2 and content_hash=$3 and version=$4',[id,input.productId,doc.content_hash,DISCOVERY_VERSION])).rows.length>0;
      if(!cached){
        const pages=await reserveAnalysis(db,job.run_id,id,Math.ceil(Math.min(doc.text.length,22000)/4)+2000,session.budget);
        if(pages==='exhausted'){await completeJob(db,job,{budgetLimited:true,skipped:'AI analysis budget exhausted; saved pages and companies are retained.'});await finishIdleResearch(db,job.run_id);return {processed:true,budgetLimited:true};}
        // Do not silently pay again after a worker died during an uncached AI call.
        if(pages==='existing'&&job.attempts>1){await parkJob(db,job,'A prior AI request has no committed response; needs review before repeating paid analysis.');return {processed:true,paused:true};}
      }
      const result=await deps.discover(db,job.run_id,input,doc,raw);let saved=0;
      if(!cached){await markBudget(db,job.run_id,'ai_pages',id,'completed');await markBudget(db,job.run_id,'ai_tokens',id,'completed');}
      for(const buyer of result.buyers){const current=(await db.query<{status:string}>('select status from runs where id=$1',[job.run_id])).rows[0];if(current.status==='cancelled')break;if(await deps.save(db,job.run_id,input,id,raw,buyer))saved++;}
      const triggers=await capabilityTriggerSnapshots(db,job.run_id,input.productId!,[id]);
      await completeJob(db,job,{saved,invalid:result.invalid,cached:result.cached,triggers});
      await researchProgress(db,job.run_id,'check',`${result.buyers.length} grounded company candidates; ${saved} newly saved.`);
      for(const reason of result.rejections.slice(0,5))await researchProgress(db,job.run_id,'info',`Not saved: ${reason}`);
    }else await completeJob(db,job,{});
    await finishIdleResearch(db,job.run_id);
    return {processed:true,runId:job.run_id};
  }catch(error){
    if(job.stage==='analyse'&&error instanceof Error&&/budget exhausted/i.test(error.message)){
      await completeJob(db,job,{budgetLimited:true,skipped:'Shared AI budget exhausted; saved original retained.'});
      await finishIdleResearch(db,job.run_id);return {processed:true,budgetLimited:true};
    }
    // Groq answers 429 for both per-minute and per-day limits; only the per-minute one clears soon.
    const perMinute=!(error instanceof QuotaExceededError)&&(error instanceof LLMHttpError&&error.status===429||error instanceof Error&&/\b429\b|rate.?limit/i.test(error.message))
      &&!(error instanceof Error&&/per day|\b(?:TPD|RPD)\b|daily/i.test(error.message));
    if(perMinute&&job.stage==='analyse'&&job.attempts<4){await retryAfterRateLimit(db,job);return {processed:true,retrying:true};}
    const quota=error instanceof Error&&/quota|rate.?limit|429|budget/i.test(error.message);
    if(quota&&job.stage==='analyse'){await parkJob(db,job,'AI provider quota/rate limit: saved research is retained.');return {processed:true,paused:true};}
    const message=error instanceof Error?error.message:'';
    if(job.stage==='collect'&&job.payload.source==='registry'){
      const warning=registryReadWarning(String(job.payload.registryId),'registry_unavailable',/^Registry HTTP \d{3}$/.test(message)?message.replace('Registry ',''):undefined);
      await completeJob(db,job,warning);await researchProgress(db,job.run_id,'info',`Registry coverage warning (${job.payload.registryId}): public source unavailable; remaining lanes continue${warning.requiresManualFetch?'; HTTP 403 requiresManualFetch':''}.`);
      await finishIdleResearch(db,job.run_id);return {processed:true,coverageWarning:true};
    }
    // Only known provider diagnostics are exposed; arbitrary errors can contain credentials or response bodies.
    const safe=error instanceof z.ZodError?`Buyer response validation failed: ${[...new Set(error.issues.map(i=>i.path.join('.')))].slice(0,5).join(', ')}. Accepted JSON is retained for review when available.`:
      /^Targeted web search (?:could not connect; no automatic paid retry|is not configured)\.$/.test(message)?message:
      /^Targeted web search unavailable \(HTTP \d{3}\)\./.test(message)?`Search provider unavailable (HTTP ${message.match(/HTTP (\d{3})/)?.[1]}). Check quota/access; no automatic paid retry.`:
      /^Targeted web search returned an unreadable response; review before repeating a chargeable search\.$/.test(message)?message:
      `Research stage failed (${error instanceof Error&&['TypeError','Error','RangeError','SyntaxError'].includes(error.name)?error.name:'Error'}); inspect provider/source configuration.`;
    await db.query(`update research_jobs set state='failed',error=$3,lease_token=null,lease_until=null where id=$1 and lease_token=$2`,[job.id,job.lease_token,safe]);
    await researchProgress(db,job.run_id,'error',`${job.stage} stage failed; no fictional result substituted.`);
    await finishIdleResearch(db,job.run_id);
    return {processed:true,failed:true};
  }
}
export async function finishIdleResearch(db:Db=getDb(),runId?:string) {
  const active=runId?[runId]:(await db.query<{run_id:string}>("select run_id from research_sessions where state='active' order by created_at limit 20")).rows.map(s=>s.run_id);
  for(const id of active){const added=await admitDeferredDiscovery(db,id);
    if(added)await researchProgress(db,id,'read',`${added} saved URLs admitted into unused reading slots; no extra search requests.`);
  }
  const sessions=(await db.query<{run_id:string}>(`select s.run_id from research_sessions s where s.state='active' and ($1::uuid is null or s.run_id=$1)
    and not exists(select 1 from research_jobs j where j.run_id=s.run_id and j.state in ('queued','running'))`,[runId??null])).rows;
  for(const s of sessions){
    // Names found outside list pages (news, company sites) are rated before the search settles (docs/mvp/18 §5).
    const rs=(await db.query<{input:RunInput|null;budget:ResearchBudget}>('select r.adhoc_query as input,s.budget from research_sessions s join runs r on r.id=s.run_id where s.run_id=$1',[s.run_id])).rows[0];
    if(rs?.input?.productId){
      const rated=await rateCandidates(db,s.run_id,rs.input,key=>budgetedAwardProviders(db,s.run_id,key,rs.budget).provider('triage')).catch(()=>null);
      if(rated?.rated.length)await researchProgress(db,s.run_id,'check',`Shortlist: rated ${rated.rated.length} more companies; ${rated.rated.filter(r=>r.rating>=45).length} look like buyers.`);
    }
    const jobs=(await db.query<{stage:string;state:string;error:string|null;payload:{source?:string;raw?:RawDoc};result:{deferred?:number;documentId?:string;unreadable?:boolean;budgetLimited?:boolean}|null}>('select stage,state,error,payload,result from research_jobs where run_id=$1',[s.run_id])).rows;
    const collections=jobs.filter(j=>j.stage==='collect');
    const remoteCollections=collections.filter(j=>!['directory-seed','registry'].includes(j.payload.source??''));
    const reads=jobs.filter(j=>j.stage==='read'&&!j.payload.raw?.research?.registryId);
    const originalRead=jobs.some(j=>j.stage==='read'&&j.result?.documentId);
    // Enqueueing a known directory URL is not evidence that a remote source was reached.
    // Likewise, an all-unreadable run is a failure, not a completed zero-buyer search.
    const noReachableOriginal=!originalRead&&(remoteCollections.length>0&&remoteCollections.every(j=>j.state==='failed')||
      reads.length>0&&reads.every(j=>j.state==='failed'||j.result?.unreadable));
    const failed=jobs.some(j=>j.state==='failed'),allSourcesFailed=remoteCollections.length>0&&remoteCollections.every(j=>j.state==='failed')&&!originalRead||noReachableOriginal;
    // A settled optional source/read failure is a coverage warning, not a permanent funnel barrier.
    // A supervised review may resume one bundle while other jobs remain parked.
    // Once runnable work settles, those jobs mean partial, not running forever.
    const budgetStop=(j:typeof jobs[number])=>j.state==='paused'&&/budget exhausted/i.test(j.error??'');
    const partial=jobs.some(j=>j.state==='paused'&&!budgetStop(j)||j.stage==='analyse'&&j.state==='failed');
    const coverageLimited=jobs.some(j=>budgetStop(j)||(j.result?.deferred??0)>0||j.result?.budgetLimited);
    // Fewer buyers than wanted: re-run the work that stopped only at a limit, under a larger budget.
    // A failed AI answer (e.g. malformed JSON) is a gap, not a reason to stop looking; only paused,
    // uncertain paid requests block another round.
    const blocking=jobs.some(j=>j.state==='paused'&&!budgetStop(j));
    if(!allSourcesFailed&&!blocking&&await extendResearchIfShort(db,s.run_id))continue;
    const state=allSourcesFailed?'failed':partial?'partial':'done';
    const stopReason=partial||coverageLimited?(jobs.find(j=>j.state==='paused')?.error||'Some sources/pages could not be processed within the budget.'):null;
    await db.tx(async tx=>{
      await tx.query(`update research_sessions set state=$2,stop_reason=$3,updated_at=now() where run_id=$1 and state='active'`,[s.run_id,state,stopReason]);
      await tx.query(`update runs set status=$2,finished_at=now(),error=$3 where id=$1 and status<>'cancelled'`,[s.run_id,allSourcesFailed?'failed':'done',allSourcesFailed?'All live sources failed. No sample data was substituted.':null]);
    });
    const counters=await researchProgress(db,s.run_id,allSourcesFailed?'error':'done',allSourcesFailed?'All live sources failed. No sample data was substituted.':`${partial?'Partial research; saved companies retained. ':coverageLimited?'Research complete with bounded coverage; saved companies retained. ':'Research complete. '}No sample data was substituted.`);
    await researchProgress(db,s.run_id,'info',`${counters.scopedProspects??0} buyer prospects saved; contact discovery/validation is separate.${failed?' Some sources/pages failed; coverage is incomplete.':''}`);
  }
}
