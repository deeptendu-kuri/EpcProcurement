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
import { admitDeferredDiscovery,completeJob,claimJob,enqueueRawDocs,markBudget,parkJob,researchProgress,reserveAnalysis,reserveBudget,sessionFor } from './store';
import { candidateForPage, extendInvestigation, seedInvestigations, domainOf, queueRead } from './investigation';
import { RESEARCH_SOURCES } from './registry';
import { bundlePromptText,discoverCompanyBundle,loadCompanyBundle } from '@/mvp/discovery/bundle';
import { z } from 'zod';
import {groundedCompanyBuyer} from '@/mvp/discovery/grounded';

export interface ResearchDeps {
  collect(source:string,ctx:SourceContext,payload:Record<string,unknown>):Promise<RawDoc[]>;
  read:typeof fetchPageText; discover:typeof discoverBuyers; save:typeof saveBuyer;
  discoverBundle?:typeof discoverCompanyBundle;
}
export const productionResearchDeps:ResearchDeps={
  async collect(source,ctx,payload){
    if(source==='directory-seed')return [payload.raw as RawDoc];
    if(source==='tavily')return collectTavilyQuery(ctx,payload.query as Parameters<typeof collectTavilyQuery>[1]);
    if(source==='bing-query')return collectBingQuery(ctx,String(payload.market),String(payload.query));
    if(source==='rss-feed')return collectRssFeed(ctx,String(payload.feed));
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
      if(source==='tavily'){
        const q=job.payload.query as Parameters<typeof collectTavilyQuery>[1];
        const cached=await cachedTavilyQuery(ctx,q);
        if(cached!==null)docs=cached;
        else{
          const reservation=await reserveBudget(db,job.run_id,'search',job.key,1,session.budget.searchQueries);
          if(reservation==='exhausted'){await parkJob(db,job,'Search query budget exhausted.');return {processed:true,paused:true};}
          if(reservation==='existing'){await parkJob(db,job,'A previous search request has no committed response; manual review is required before repeating a charged query.');return {processed:true,paused:true};}
          try{docs=await deps.collect(source,ctx,job.payload);await markBudget(db,job.run_id,'search',job.key,'completed');}
          catch(error){await markBudget(db,job.run_id,'search',job.key,'unknown');throw error;}
        }
      }else docs=await deps.collect(source,ctx,job.payload);
      await enqueueRawDocs(db,job,docs,session.budget.maxPages);
      await researchProgress(db,job.run_id,'collect',`${source}: ${docs.length} original-page candidates. Discovery is saved; contact validation is separate.`);
    }else if(job.stage==='read'){
      const raw=job.payload.raw as RawDoc;
      const domain=await reserveBudget(db,job.run_id,`domain:${new URL(raw.url).hostname}`,job.key,1,session.budget.maxPagesPerDomain);
      if(domain==='exhausted'){
        await completeJob(db,job,{domainLimited:true});await researchProgress(db,job.run_id,'info','A page was not read because this domain reached its bounded coverage limit.');return {processed:true};
      }
      const reservation=await reserveBudget(db,job.run_id,'read',job.key,1,session.budget.maxPages);
      if(reservation==='exhausted'){await parkJob(db,job,'Page-read budget exhausted.');return {processed:true,paused:true};}
      let text=raw.text,title=raw.title,publishedAt=raw.publishedAt;
      let links:{url:string;text:string}[]=[];let format='html';let truncated=false;let pdfPages=0;let finalUrl=raw.url;
      if(!text){
        const used=(await db.query<{units:number}>("select coalesce(sum(units),0)::int as units from research_budget_reservations where run_id=$1 and kind='pdf_pages'",[job.run_id])).rows[0].units;
        const page=await deps.read(raw.url,{fullPage:raw.research?.lane!=='news',maxPdfPages:Math.max(0,Math.min(10,20-used))});
        if(!page.ok){
          await completeJob(db,job,{unreadable:true,failureReason:page.reason});await markBudget(db,job.run_id,'read',job.key,'completed');
          if(raw.research?.candidateId)await db.query("update research_candidates set state='unreadable',reason=$2 where id=$1 and run_id=$3",[raw.research.candidateId,`Website read failed (${page.reason}); company research retained.`,job.run_id]);
          await researchProgress(db,job.run_id,'read',`Source read failed (${page.reason}); no invented content substituted.`);return {processed:true};
        }
        text=page.title&&!page.text.includes(page.title)?`${page.title}\n${page.text}`:page.text;title=page.title??title;publishedAt=page.publishedAt??publishedAt;
        links=page.links??[];format=page.format??'html';truncated=Boolean(page.truncated);pdfPages=page.pages?.length??0;finalUrl=page.finalUrl??raw.url;
        if(pdfPages){await reserveBudget(db,job.run_id,'pdf_pages',job.key,pdfPages,20);await markBudget(db,job.run_id,'pdf_pages',job.key,'completed');}
      }
      // storeDocument deduplicates content/URL; all later quotes retain the stored original's provenance.
      const stored=await storeDocument(db,job.run_id,{...raw,url:finalUrl,text,title,publishedAt,publisherKey:raw.publisherKey??publisherKeyFor(finalUrl)});
      await db.query('insert into run_documents(run_id,document_id) values($1,$2) on conflict do nothing',[job.run_id,stored.id]);
      const original=(await db.query<{url:string;title:string|null;source_key:string;source_name:string;tier:RawDoc['tier'];published_at:string|null;is_sample:boolean}>('select url,title,source_key,source_name,tier,published_at,is_sample from source_documents where id=$1',[stored.id])).rows[0];
      const grounded:RawDoc={...raw,url:original.url,title:original.title,text:stored.text,publishedAt:original.published_at,sourceKey:original.source_key,sourceName:original.source_name,tier:original.tier,isSample:original.is_sample};
      const candidate=buyerPageCandidate(stored.text,input.productId!)&&!/\/(?:jobs?|careers)(?:[/-]|$)/i.test(new URL(grounded.url).pathname);
      let associated=await candidateForPage(db,job.run_id,grounded);
      if(!associated){
        const seeded=await seedInvestigations(db,job.run_id,input,stored.id,grounded,stored.text,title,session.budget);
        if(seeded.seeds)await researchProgress(db,job.run_id,'info',`${seeded.seeds} company research seeds; ${seeded.queued} website investigations. Seeds are not qualified buyers.`);
        if(seeded.ownName)associated=await candidateForPage(db,job.run_id,grounded);
      }
      const scoped=associated?await extendInvestigation(db,job.run_id,associated,grounded,stored.id,stored.text,links,input,session.budget):false;
      let paginationLimited=false;
      if(raw.research?.registryId){
        const entry=RESEARCH_SOURCES.find(s=>s.id===raw.research?.registryId);
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
      await completeJob(db,job,{documentId:stored.id,candidate,format,truncated,pdfPages,paginationLimited,requestedUrl:raw.url,finalUrl},candidate&&!scoped&&raw.research?.lane!=='directory'?[{stage:'analyse',key:stored.id,payload:{documentId:stored.id,raw:grounded},priority:buyerResearchPriority(grounded,stored.text,input)}]:[]);
      await markBudget(db,job.run_id,'read',job.key,'completed');
      await researchProgress(db,job.run_id,'read',`Original page saved${candidate?' for company/material analysis':''}.`);
    }else if(job.stage==='analyse'){
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
          if(reserve==='exhausted'){await parkJob(db,job,'AI analysis budget exhausted; original company research is retained.');return {processed:true,paused:true};}
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
        await completeJob(db,job,{saved,invalid:result.invalid,cached:result.cached,deterministic:Boolean(grounded)});
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
        if(pages==='exhausted'){await parkJob(db,job,'AI analysis budget exhausted; saved pages and companies are retained.');return {processed:true,paused:true};}
        // Do not silently pay again after a worker died during an uncached AI call.
        if(pages==='existing'&&job.attempts>1){await parkJob(db,job,'A prior AI request has no committed response; needs review before repeating paid analysis.');return {processed:true,paused:true};}
      }
      const result=await deps.discover(db,job.run_id,input,doc,raw);let saved=0;
      if(!cached){await markBudget(db,job.run_id,'ai_pages',id,'completed');await markBudget(db,job.run_id,'ai_tokens',id,'completed');}
      for(const buyer of result.buyers){const current=(await db.query<{status:string}>('select status from runs where id=$1',[job.run_id])).rows[0];if(current.status==='cancelled')break;if(await deps.save(db,job.run_id,input,id,raw,buyer))saved++;}
      await completeJob(db,job,{saved,invalid:result.invalid,cached:result.cached});
      await researchProgress(db,job.run_id,'check',`${result.buyers.length} grounded company candidates; ${saved} newly saved.`);
      for(const reason of result.rejections.slice(0,5))await researchProgress(db,job.run_id,'info',`Not saved: ${reason}`);
    }else await completeJob(db,job,{});
    await finishIdleResearch(db,job.run_id);
    return {processed:true,runId:job.run_id};
  }catch(error){
    const quota=error instanceof Error&&/quota|rate.?limit|429|budget/i.test(error.message);
    if(quota&&job.stage==='analyse'){await parkJob(db,job,'AI provider quota/rate limit: saved research is retained.');return {processed:true,paused:true};}
    const message=error instanceof Error?error.message:'';
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
    const jobs=(await db.query<{stage:string;state:string;error:string|null;payload:{source?:string};result:{deferred?:number;documentId?:string;unreadable?:boolean}|null}>('select stage,state,error,payload,result from research_jobs where run_id=$1',[s.run_id])).rows;
    const collections=jobs.filter(j=>j.stage==='collect');
    const remoteCollections=collections.filter(j=>j.payload.source!=='directory-seed');
    const reads=jobs.filter(j=>j.stage==='read');
    const originalRead=reads.some(j=>j.result?.documentId);
    // Enqueueing a known directory URL is not evidence that a remote source was reached.
    // Likewise, an all-unreadable run is a failure, not a completed zero-buyer search.
    const noReachableOriginal=!originalRead&&(remoteCollections.length>0&&remoteCollections.every(j=>j.state==='failed')||
      reads.length>0&&reads.every(j=>j.state==='failed'||j.result?.unreadable));
    const failed=jobs.some(j=>j.state==='failed'),allSourcesFailed=collections.every(j=>j.state==='failed')||noReachableOriginal;
    // A settled optional source/read failure is a coverage warning, not a permanent funnel barrier.
    // A supervised review may resume one bundle while other jobs remain parked.
    // Once runnable work settles, those jobs mean partial, not running forever.
    const partial=jobs.some(j=>j.state==='paused'||j.stage==='analyse'&&j.state==='failed')||jobs.some(j=>(j.result?.deferred??0)>0);
    const state=allSourcesFailed?'failed':partial?'partial':'done';
    const stopReason=partial?(jobs.find(j=>j.state==='paused')?.error||'Some sources/pages could not be processed within the budget.'):null;
    await db.tx(async tx=>{
      await tx.query(`update research_sessions set state=$2,stop_reason=$3,updated_at=now() where run_id=$1 and state='active'`,[s.run_id,state,stopReason]);
      await tx.query(`update runs set status=$2,finished_at=now(),error=$3 where id=$1 and status<>'cancelled'`,[s.run_id,allSourcesFailed?'failed':'done',allSourcesFailed?'All live sources failed. No sample data was substituted.':null]);
    });
    const counters=await researchProgress(db,s.run_id,allSourcesFailed?'error':'done',allSourcesFailed?'All live sources failed. No sample data was substituted.':`${partial?'Partial research; saved companies retained. ':'Research complete. '}No sample data was substituted.`);
    await researchProgress(db,s.run_id,'info',`${counters.scopedProspects??0} buyer prospects saved; contact discovery/validation is separate.${failed?' Some sources/pages failed; coverage is incomplete.':''}`);
  }
}
