import { randomBytes,randomUUID } from "node:crypto";
import { getCatalogue } from "@/mvp/config/buyers-config";
import { getDb,type Queryable } from "@/mvp/db";
import { getOpportunity,isVerified,updateOpportunity,type Opportunity } from "@/mvp/opportunities";
import { AUTOMATION_RECIPIENT,calendarPreferences,calendarConnected,requireFunnelConfig,receivingDomain,seller,demoCustomer,prospectDemoEnabled,prospectsPerSearch } from "./config";
import { qualifyBuyer,initialEmail,analyseReply } from "./ai";
import { prepareContact } from "./contacts";
import { availableSlots,bookDemoMeeting,MeetingSlotUnavailableError } from "./calendar";
import { approvedIncoming,listInboxPage,readInbound,replyAddress,sendFunnelMessage } from "./resend";
import { businessTime,FOLLOWUP_DELAY_MS,hardStop,MAX_FOLLOWUPS,messageIdSafe } from "./policy";
import { offeredSlotLabel,resolveMeetingTime } from './meeting-time';
import { DEMO_DAILY_LIMIT,demoAttemptsToday } from "@/mvp/email/budget";
import { searchedProductLabel } from '@/mvp/config/product-label';

export interface FunnelThread {
  id:string;opportunity_id:string|null;company_id:string|null;product_id:string;person_id:string|null;reply_token:string;
  mode:"buyer"|"email_test"|"prospect_demo";recipient:string;test_product:string|null;
  state:string;paused:boolean;reason:string;next_action_at:string;followups:number;offered_slots:string[];
  meeting_start:string|null;event_id:string|null;meet_url:string|null;summary:string;created_at:string;updated_at:string;
  meeting_checks?:number;
}
export interface FunnelMessage {
  id:string;thread_id:string;direction:string;kind:string;dedup_key:string;subject:string;body:string;state:string;
  provider_id:string|null;rfc_message_id:string|null;in_reply_to:string|null;reply_to:string|null;
  attempts:number;first_attempt_at:string|null;error:string|null;analysed_at:string|null;created_at:string;
}
const errorText=(e:unknown)=>e instanceof Error?e.message.slice(0,600):"Automation could not complete this step. Review before retrying.";
const note=async (tx:Queryable,id:string|null,body:string)=>{if(id)await tx.query("insert into opportunity_events(opportunity_id,body) values ($1,$2)",[id,body]);};
async function approvedDemoOpportunity(o:Opportunity|null) {
  if(!o || o.is_sample || o.qualification!=="approved")return false;
  return (await getDb().query(`select e.id from evidence e join run_documents rd on rd.document_id=e.document_id
    where e.id=any($1::uuid[]) and e.quote_verified=true and rd.run_id=$2 limit 1`,[o.evidence_ids,o.run_id])).rows.length>0;
}

/** Reviewing one saved prospect never declares its paused research complete. */
export async function reviewedProspectStatus(opportunityId:string, db:Queryable=getDb()) {
  const row=(await db.query<{company_id:string;product_id:string;run_id:string;qualification:string;is_sample:boolean;status:string;run_created_at:string;research_state:string|null;has_evidence:boolean}>(`select o.company_id,o.product_id,o.run_id,o.qualification,l.is_sample,r.status,r.created_at as run_created_at,rs.state as research_state,
    exists(select 1 from evidence e join run_documents rd on rd.document_id=e.document_id
      where e.id=any(o.evidence_ids) and e.quote_verified=true and rd.run_id=o.run_id) as has_evidence
    from search_opportunities o join leads l on l.id=o.lead_id join runs r on r.id=o.run_id
    left join research_sessions rs on rs.run_id=o.run_id where o.id=$1`,[opportunityId])).rows[0];
  if(!row)return null;
  const existing=(await db.query<{id:string;opportunity_id:string|null}>("select id,opportunity_id from funnel_threads where company_id=$1 and product_id=$2",[row.company_id,row.product_id])).rows[0];
  const prior=(await db.query(`select 1 from demo_campaigns where company_id=$1 and product_id=$2 and status<>'cancelled'
    union all select 1 from outreach_drafts where opportunity_id=$3 and delivery_first_attempt_at is not null limit 1`,[row.company_id,row.product_id,opportunityId])).rows.length>0;
  const count=(await db.query<{count:number}>(`select count(*)::int as count from funnel_threads ft join search_opportunities o on o.id=ft.opportunity_id
    where o.run_id=$1 and (ft.state not in ('review','stopped') or exists(select 1 from funnel_messages m where m.thread_id=ft.id and m.kind='initial' and m.first_attempt_at is not null))`,[row.run_id])).rows[0].count;
  const reason=!prospectDemoEnabled()?"Approved-inbox prospect demo mode is not configured."
    :row.is_sample?"Sample leads cannot start a researched-prospect conversation."
    :row.status!=='done'||row.research_state && !['done','partial'].includes(row.research_state)?"Wait until research finishes or pauses with saved results."
    :row.qualification!=='approved'?"Confirm potential buyer fit in this workspace before starting the demo."
    :!row.has_evidence?"This prospect needs verified original-source evidence from its own search."
    :existing?"This company and product already have a conversation. Open it instead of sending another introduction."
    :prior?"This company and product already have separate outreach history. Review it before starting another conversation."
    :count>=prospectsPerSearch()?"The demo conversation limit for this search has been reached."
    :null;
  const control=(await db.query<{enabled:boolean;enabled_at:string|null}>('select enabled,enabled_at from funnel_control where id=1')).rows[0];
  const automaticReason=!control?.enabled?'Automation is paused. Enable it once in Settings before a new search.'
    :!control.enabled_at||Date.parse(row.run_created_at)<Date.parse(control.enabled_at)?'Historical search: retained for reference, not automatically emailed. Run a new search to start the automatic demo.'
    :row.is_sample||row.qualification==='rejected'?'Sample or rejected company; no automatic email.'
    :row.status!=='done'||row.research_state&&!['done','partial'].includes(row.research_state)?'Research is running. Saved results remain visible; automatic qualification starts when this run settles.'
    :!row.has_evidence?'Original-source evidence is needed before automatic qualification.'
    :existing?'This company and product already have a conversation.'
    :prior?'Separate outreach history exists; no duplicate introduction.'
    :count>=prospectsPerSearch()?'One demo conversation is already selected for this search. All other companies remain saved.'
    :null;
  return {canStart:!reason,reason,researchState:row.research_state,researchPaused:row.research_state==='partial',
    automaticEligible:prospectDemoEnabled()&&!automaticReason,automaticReason,
    existingOpportunityId:existing?.opportunity_id??null,threadId:existing?.id??null};
}

/** Explicitly queue ONE reviewed, grounded saved prospect, including a partial search. No provider I/O. */
export async function startReviewedProspectDemo(opportunityId:string) {
  requireFunnelConfig();
  if(process.env.MVP_FUNNEL_WORKER!=='on')throw new Error("The background email worker is off. Restart the local demo with its worker enabled.");
  const db=getDb();return db.tx(async tx=>{
    // Serialize with automatic enrollment and other manual starts; never exceed the per-search cap.
    const control=(await tx.query<{enabled:boolean}>("select enabled from funnel_control where id=1 for update")).rows[0];
    if(!control?.enabled)throw new Error("Enable the demo funnel first.");
    if((await tx.query("select recipient from funnel_suppressions where recipient=$1",[AUTOMATION_RECIPIENT])).rows.length)throw new Error("This inbox opted out; a reviewed prospect cannot bypass suppression.");
    const status=await reviewedProspectStatus(opportunityId,tx);
    if(!status)throw new Error("Prospect not found.");
    // Network retries/double clicks reuse the existing thread, never resume or replace it.
    if(status.threadId && status.existingOpportunityId===opportunityId)
      return (await tx.query<FunnelThread>("select * from funnel_threads where id=$1",[status.threadId])).rows[0];
    if(!status.canStart)throw new Error(status.reason!);
    const t=(await tx.query<FunnelThread>(`insert into funnel_threads(opportunity_id,company_id,product_id,reply_token,recipient,mode,reason)
      select id,company_id,product_id,$2,$3,'prospect_demo','Reviewed prospect queued for an approved-inbox demo; buyer contact validation stays separate'
      from search_opportunities where id=$1 returning *`,[opportunityId,randomBytes(24).toString('hex'),AUTOMATION_RECIPIENT])).rows[0];
    await note(tx,opportunityId,`User started one reviewed-prospect demo to ${AUTOMATION_RECIPIENT}. ${status.researchPaused?'Research remains paused; only this saved company was selected.':'Saved search context retained.'} No real buyer contacted.`);
    return t;
  });
}

async function threadContext(t:FunnelThread):Promise<Opportunity|null> {
  if(t.mode!=="email_test")return t.opportunity_id?getOpportunity(t.opportunity_id):null;
  return {id:t.id,run_id:"",lead_id:"",keyword:"Email workflow test — not a real buyer",product_id:t.product_id,product_name:t.test_product!,
    contact_role:"buyer",buying_reason:"Dedicated inbox owner is role-playing a buyer to test the email conversation. No real company, project, purchase or contact qualification is claimed.",
    evidence_ids:[],qualification:"pending",summary:t.summary,owner_name:seller().name,next_action:"Test email conversation",follow_up_at:null,created_at:t.created_at,
    name:"Demo inbox owner",country:null,is_sample:true,validated_emails:0,sent:false};
}
/** One durable test per approved inbox. No company, lead or verified CRM record is created. */
export async function startEmailTest(productId:string) {
  requireFunnelConfig();
  const product=getCatalogue().items.find(p=>p.id===productId);if(!product)throw new Error("Choose a product from the existing catalogue.");
  const db=getDb();return db.tx(async tx=>{
    const control=(await tx.query<{enabled:boolean}>("select enabled from funnel_control where id=1 for update")).rows[0];
    if(!control?.enabled)throw new Error("Enable the demo funnel first.");
    if((await tx.query("select recipient from funnel_suppressions where recipient=$1",[AUTOMATION_RECIPIENT])).rows.length)throw new Error("This inbox opted out; a test cannot bypass suppression.");
    const existing=(await tx.query<FunnelThread>("select * from funnel_threads where mode='email_test' and recipient=$1",[AUTOMATION_RECIPIENT])).rows[0];
    if(existing)return existing;
    return (await tx.query<FunnelThread>(`insert into funnel_threads(mode,recipient,product_id,test_product,reply_token,reason)
      values('email_test',$1,$2,$3,$4,'Live email workflow test queued; not a qualified buyer') returning *`,[AUTOMATION_RECIPIENT,product.id,product.shortName||product.name,randomBytes(24).toString("hex")])).rows[0];
  });
}

export async function listFunnelThreads(opportunityId?:string) {
  return (await getDb().query<FunnelThread&{company:string;product:string;keyword:string;run_id:string|null;project_name:string|null}>(`select t.*,coalesce(o.product_name,t.test_product) as product,coalesce(o.keyword,'Email workflow test — not a buyer') as keyword,o.run_id,p.name as project_name,coalesce(c.canonical_name,'Your demo inbox') as company
    from funnel_threads t left join search_opportunities o on o.id=t.opportunity_id left join companies c on c.id=t.company_id left join leads l on l.id=o.lead_id left join projects p on p.id=l.project_id
    ${opportunityId?"where t.opportunity_id=$1":""} order by t.created_at desc limit 200`,opportunityId?[opportunityId]:[])).rows
    .map(({reply_token,...row})=>({...row,product:searchedProductLabel(row.product_id,row.keyword,row.product),hasReplyAddress:Boolean(reply_token)}));
}
/** An explicitly requested, one-time corrected introduction for the existing inbox test only. */
export async function sendSellerTestIntroduction(id:string) {
  requireFunnelConfig();const db=getDb();
  const t=(await db.query<FunnelThread>("select * from funnel_threads where id=$1 and mode='email_test' and recipient=$2",[id,AUTOMATION_RECIPIENT])).rows[0];
  if(!t)throw new Error("Use the current approved inbox-test conversation.");
  if(!["active","engaged"].includes(t.state)||t.paused)throw new Error("Wait for this conversation's current step to finish, or resume it first.");
  if(!(await db.query<{enabled:boolean}>("select enabled from funnel_control where id=1")).rows[0]?.enabled)throw new Error("Enable the demo funnel first.");
  if((await db.query("select id from funnel_messages where thread_id=$1 and (direction='in' and analysed_at is null or direction='out' and state in ('queued','sending','review'))",[id])).rows.length)throw new Error("A reply or delivery is pending; do not interrupt that step.");
  const o=await threadContext(t);if(!o)throw new Error("Test context missing.");
  await queueMessage(t,`seller-intro-v2-${id}`,"seller_intro",await initialEmail(o,{name:demoCustomer().name,title:"Approved demo customer"}));
}
export async function listThreadMessages(opportunityId:string) {
  return (await getDb().query<Pick<FunnelMessage,"id"|"direction"|"kind"|"subject"|"body"|"state"|"created_at"|"error">>(`select m.id,m.direction,m.kind,m.subject,m.body,m.state,m.created_at,m.error from funnel_messages m
    join funnel_threads t on t.id=m.thread_id where t.opportunity_id=$1 order by m.created_at,m.id limit 100`,[opportunityId])).rows;
}
export async function listEmailTestMessages(threadId:string) {
  return (await getDb().query<Pick<FunnelMessage,"id"|"direction"|"kind"|"subject"|"body"|"state"|"created_at"|"error">>(`select m.id,m.direction,m.kind,m.subject,m.body,m.state,m.created_at,m.error from funnel_messages m join funnel_threads t on t.id=m.thread_id where t.id=$1 and t.mode='email_test' and t.recipient=$2 order by m.created_at,m.id limit 100`,[threadId,AUTOMATION_RECIPIENT])).rows;
}
export async function controlThread(id:string,action:"pause"|"resume"|"stop"|"retry") {
  await getDb().tx(async tx=>{
    const t=(await tx.query<FunnelThread>("select * from funnel_threads where id=$1 for update",[id])).rows[0];
    if (!t) throw new Error("Conversation not found.");
    if (["stopped","meeting_booked"].includes(t.state)) throw new Error("A stopped or booked conversation cannot be restarted automatically.");
    if (action==="stop") {
      await tx.query("update funnel_messages set state='cancelled' where thread_id=$1 and state='queued'",[id]);
      await tx.query("update funnel_threads set state='stopped',reason='Stopped by user',updated_at=now() where id=$1",[id]);
    } else if (action==="retry") {
      const uncertain=(await tx.query("select id from funnel_messages where thread_id=$1 and state='review' and attempts>0",[id])).rows;
      if (uncertain.length) throw new Error("An attempted delivery needs review in Resend. Do not restart uncertain sends.");
      const incoming=(await tx.query("select id from funnel_messages where thread_id=$1 and direction='in' and analysed_at is null",[id])).rows.length;
      const recovery=t.meeting_start?"meeting_pending":incoming?"engaged":"qualifying";
      await tx.query("update funnel_threads set paused=false,state=case when state='review' then $2 else state end,next_action_at=now(),reason='',updated_at=now() where id=$1",[id,recovery]);
    } else await tx.query("update funnel_threads set paused=$2,updated_at=now() where id=$1",[id,action==="pause"]);
    await note(tx,t.opportunity_id,`Demo funnel: ${action}. Already accepted mail or an in-flight provider request cannot be recalled.`);
  });
}
/** Operator recovery for one real selection incorrectly clarified by an old parser.
 * No fabricated inbound mail, delivery replay, pause override or provider I/O. */
export async function recoverMeetingSelection(id:string,messageId:string) {
  requireFunnelConfig();
  return getDb().tx(async tx=>{
    const control=(await tx.query<{enabled:boolean;busy:boolean}>("select enabled,coalesce(worker_until>now(),false) as busy from funnel_control where id=1 for update")).rows[0];
    if(!control?.enabled)throw new Error('Automation is paused. No reply recovered.');
    if(control.busy)throw new Error('The worker is processing a step. Try recovery after it finishes.');
    const t=(await tx.query<FunnelThread>('select * from funnel_threads where id=$1 for update',[id])).rows[0];
    if(!t||t.recipient!==AUTOMATION_RECIPIENT)throw new Error('Use the current approved-inbox conversation.');
    if(t.paused||t.state!=='awaiting_time'||t.event_id||t.meet_url||t.meeting_start)throw new Error('Only an active, unbooked conversation awaiting a time can recover a selection.');
    if((await tx.query('select recipient from funnel_suppressions where recipient=$1',[AUTOMATION_RECIPIENT])).rows.length)throw new Error('This inbox opted out; recovery is blocked.');
    const latest=(await tx.query<FunnelMessage>("select * from funnel_messages where thread_id=$1 and direction='in' order by created_at desc,id desc limit 1",[id])).rows[0];
    if(!latest||latest.id!==messageId||!latest.analysed_at||latest.state!=='received'||latest.kind!=='reply'||hardStop(latest.body))throw new Error('Recover only the latest previously analysed real reply.');
    if((await tx.query("select id from funnel_messages where thread_id=$1 and direction='out' and state in ('queued','sending','review')",[id])).rows.length)throw new Error('Delivery is pending or uncertain; recovery is blocked.');
    const outgoing=(await tx.query<FunnelMessage>("select * from funnel_messages where thread_id=$1 and direction='out' order by created_at desc,id desc limit 1",[id])).rows[0];
    if(!outgoing||outgoing.kind!=='scheduling_clarification'||outgoing.state!=='accepted'||outgoing.dedup_key!==`reply-${latest.id}`)throw new Error('This reply was not the latest accepted scheduling clarification.');
    const time=resolveMeetingTime(latest.body,t.offered_slots,new Date(latest.created_at),calendarPreferences());
    if(time.kind!=='selected')throw new Error('The real reply does not identify one agreed meeting time.');
    await tx.query('update funnel_messages set analysed_at=null where id=$1',[latest.id]);
    await tx.query("update funnel_threads set state='engaged',next_action_at=now(),reason='Recovering latest real slot selection after parser correction',updated_at=now() where id=$1",[id]);
    await note(tx,t.opportunity_id,`Recovered real meeting selection ${latest.id} after a parser correction. Normal worker will recheck Calendar availability; no meeting is claimed yet.`);
    return {threadId:id,messageId:latest.id,start:time.start};
  });
}
/** Settled source-backed companies can enroll even if other research paused. Never replay old runs. */
export async function enrollCompletedSearches():Promise<number> {
  const db=getDb();const control=(await db.query<{enabled:boolean;enabled_at:string}>("select enabled,enabled_at from funnel_control where id=1")).rows[0];
  if (!control?.enabled) return 0;
  const candidates=(await db.query<{id:string;company_id:string;product_id:string}>(`select id,company_id,product_id from (select o.id,o.company_id,o.product_id,o.run_id,o.created_at,
      row_number() over(partition by o.run_id order by o.fit_score desc,o.created_at,o.id) as rank
      from search_opportunities o join runs r on r.id=o.run_id join leads l on l.id=o.lead_id
    where r.status='done' and r.created_at >= $1 and not l.is_sample and o.qualification <> 'rejected'
      and not exists(select 1 from research_sessions rs where rs.run_id=o.run_id and
        (rs.state not in ('done','partial') or rs.state='partial' and not $2::boolean))
      and (not $2::boolean or exists(select 1 from evidence e join run_documents rd on rd.document_id=e.document_id
        where e.id=any(o.evidence_ids) and e.quote_verified=true and rd.run_id=o.run_id))
      and not exists(select 1 from demo_campaigns dc where dc.company_id=o.company_id and dc.product_id=o.product_id and dc.status<>'cancelled')
      and not exists(select 1 from outreach_drafts d where d.opportunity_id=o.id and d.delivery_first_attempt_at is not null)
      and not exists(select 1 from funnel_threads ft where ft.company_id=o.company_id and ft.product_id=o.product_id)
    ) candidates where not $2::boolean or rank <= greatest(0,$3-(select count(*) from funnel_threads ft join search_opportunities existing on existing.id=ft.opportunity_id where existing.run_id=candidates.run_id
      and (ft.state not in ('review','stopped') or exists(select 1 from funnel_messages attempted where attempted.thread_id=ft.id and attempted.kind='initial' and attempted.first_attempt_at is not null))))
    order by created_at limit 100`,[control.enabled_at,prospectDemoEnabled(),prospectsPerSearch()])).rows;
  let count=0;
  for (const c of candidates) await db.tx(async tx=>{
    const control=(await tx.query<{enabled:boolean}>("select enabled from funnel_control where id=1 for update")).rows[0];
    if(!control?.enabled)return;
    if(prospectDemoEnabled()) {
      const used=(await tx.query<{count:number}>(`select count(*)::int as count from funnel_threads ft join search_opportunities o on o.id=ft.opportunity_id
        where o.run_id=(select run_id from search_opportunities where id=$1) and (ft.state not in ('review','stopped') or exists(select 1 from funnel_messages m where m.thread_id=ft.id and m.kind='initial' and m.first_attempt_at is not null))`,[c.id])).rows[0].count;
      if(used>=prospectsPerSearch())return;
    }
    const inserted=await tx.query(`insert into funnel_threads(opportunity_id,company_id,product_id,reply_token,recipient,mode) values ($1,$2,$3,$4,$5,$6)
      on conflict do nothing returning id`,[c.id,c.company_id,c.product_id,randomBytes(24).toString("hex"),AUTOMATION_RECIPIENT,prospectDemoEnabled()?"prospect_demo":"buyer"]);
    if (inserted.rows.length) {count++;await note(tx,c.id,prospectDemoEnabled()?"Saved company → automatic evidence-backed buyer-fit check → approved-inbox demo. Research may remain partial; buyer contact validation stays separate. No buyer is contacted.":"Search complete → automatic buyer qualification queued. Demo delivery is Gmail-only; validated contacts are never actual recipients.");}
  });
  return count;
}
async function updateState(t:FunnelThread,state:string,reason:string,next?:Date) {
  await getDb().query("update funnel_threads set state=$2,reason=$3,next_action_at=coalesce($4::timestamptz,next_action_at),updated_at=now() where id=$1",[t.id,state,reason,next?.toISOString()??null]);
}
async function queueMessage(t:FunnelThread,key:string,kind:string,text:{subject:string;body:string},inReplyTo:string|null=null) {
  const replyTo=replyAddress(t.reply_token);
  await getDb().query(`insert into funnel_messages(thread_id,direction,kind,dedup_key,subject,body,state,reply_to,in_reply_to)
    values ($1,'out',$2,$3,$4,$5,'queued',$6,$7) on conflict (dedup_key) do nothing`,
    [t.id,kind,key,`[Demo] ${text.subject.replace(/^\[Demo\]\s*/i,"")}`,`${text.body.trim()}\n\n${t.mode==='prospect_demo'?`Research opportunity: ${(await threadContext(t))?.name??'potential company'} — this is an approved-inbox demonstration; buyer contact validation is separate.\n`:''}Demo customer: ${demoCustomer().name}. Seller: ${seller().name}. No actual buyer is being contacted. Reply "unsubscribe" to stop.`,replyTo,messageIdSafe(inReplyTo)]);
}
/** Scan the entire bounded inbox before outreach; incomplete/failed polling prevents sending. */
export async function ingestInbox():Promise<number> {
  receivingDomain();const db=getDb();let cursor:string|undefined;let imported=0;
  for (let page=0;page<10;page++) {
    const emails=await listInboxPage(cursor);
    for (const item of emails.data) {
      const t=(await db.query<FunnelThread>("select * from funnel_threads where ('lead-' || reply_token || '@' || $1)=any($2::text[])",[receivingDomain(),item.to.map(s=>s.toLowerCase())])).rows[0];
      if (!t || t.recipient!==AUTOMATION_RECIPIENT || Date.parse(item.created_at)<Date.parse(t.created_at)) continue;
      if ((await db.query("select id from funnel_messages where provider_id=$1",[item.id])).rows.length) continue;
      const full=await readInbound(item.id);
      if (!approvedIncoming(full) || !full.to.some(address=>address.toLowerCase()===replyAddress(t.reply_token))) continue;
      // HTML-only or attachment-only messages need human review, not an invented interpretation.
      const stop=hardStop(full.text??"",full.headers??{});
      await db.tx(async tx=>{
        const saved=await tx.query(`insert into funnel_messages(thread_id,direction,kind,dedup_key,subject,body,state,provider_id,rfc_message_id,sender)
          values ($1,'in',$2,$3,$4,$5,'received',$6,$7,$8) on conflict do nothing returning id`,
          [t.id,stop??"reply",`inbound-${full.id}`,full.subject.slice(0,200),full.text?.slice(0,16000)??"[HTML/attachment-only reply — human review required]",full.id,messageIdSafe(full.message_id),AUTOMATION_RECIPIENT]);
        if (!saved.rows.length) return;
        imported++;
        // Receiving any reply cancels queued chasing before AI analysis, even when paused.
        await tx.query("update funnel_messages set created_at=$2::timestamptz where id=$1",[saved.rows[0].id,full.created_at]);
        await tx.query("update funnel_messages set state='cancelled' where thread_id=$1 and direction='out' and state='queued' and attempts=0",[t.id]);
        if (stop) await tx.query("update funnel_messages set analysed_at=now() where id=$1",[saved.rows[0].id]);
        if (stop==="opt_out") {
          await tx.query("insert into funnel_suppressions(recipient,reason) values ($1,'Recipient opted out') on conflict do nothing",[AUTOMATION_RECIPIENT]);
          await tx.query("update funnel_threads set state='stopped',reason='Recipient opted out',updated_at=now() where state<>'meeting_booked'");
          await tx.query("update funnel_messages set state='cancelled' where direction='out' and state='queued'");
        } else if (stop==="rejected" || stop==="auto_reply") {
          await tx.query("update funnel_threads set state='stopped',reason=$2,updated_at=now() where id=$1 and state<>'meeting_booked'",[t.id,stop==="rejected"?"Buyer declined":"Automatic reply; no automated reply loop"]);
        } else if (!["stopped","meeting_booked"].includes(t.state)) {
          const uncertain=(await tx.query("select id from funnel_messages where thread_id=$1 and direction='out' and state in ('queued','sending','review') and attempts>0",[t.id])).rows.length;
          await tx.query("update funnel_threads set state=$2,next_action_at=now(),reason=$3,updated_at=now() where id=$1",[t.id,uncertain?"review":"engaged",uncertain?"Reply received while delivery was uncertain. Review Resend acceptance before continuing.":"Actual reply received; prospecting follow-ups cancelled"]);
        }
        await note(tx,t.opportunity_id,`Actual demo inbox reply received${stop?`: ${stop}`:"; AI analysis queued"}.`);
      });
    }
    if (!emails.has_more) return imported;
    cursor=emails.data.at(-1)?.id;
    if (!cursor) throw new Error("Inbox pagination was incomplete; outgoing automation paused.");
  }
  throw new Error("Inbox exceeded the safety scan limit. No outgoing emails were sent; review inbox pagination.");
}
async function offerMeetingSlots(t:FunnelThread,o:Opportunity,replacement=false) {
  const db=getDb();
  const latest=(await db.query<FunnelMessage>(`select * from funnel_messages where thread_id=$1 and direction='in' ${replacement?'':'and analysed_at is null'} order by created_at desc,id desc limit 1`,[t.id])).rows[0];
  if(!latest)throw new Error("The meeting request is missing. Review the conversation before offering times.");
  const slots=await availableSlots();
  await db.query("update funnel_threads set state='awaiting_time',meeting_start=null,meeting_checks=0,offered_slots=$2::jsonb,reason=$3,updated_at=now() where id=$1",[t.id,JSON.stringify(slots),slots.length?'Available times sent; waiting for your agreement':'No free slots this week; asking for a preferred date']);
  const p=calendarPreferences();const body=`${replacement?'The previous time is no longer available. I have checked for alternatives.':`Thank you — I'd be happy to discuss ${o.product_name}.`}\n\n${slots.length?`Please choose one of these currently available ${p.duration}-minute slots (${p.timeZone}):\n${slots.map((s,i)=>`Slot ${i+1}: ${offeredSlotLabel(s,p.timeZone)}`).join("\n")}`:`There are no free working-hour slots in the next seven days.`}\n\nYou can reply naturally with your preferred date and time, including AM/PM, or choose an offered slot (for example, "the second one works"). Times are in ${p.timeZone} unless you specify another timezone. I'll recheck availability before booking and share the meeting link.\n\nKind regards,\n${seller().name}`;
  await queueMessage(t,replacement?`replacement-${latest.id}`:`reply-${latest.id}`,"slots",{subject:`Re: ${o.product_name} discussion`,body},latest.rfc_message_id);
  await db.query("update funnel_messages set analysed_at=now() where thread_id=$1 and direction='in' and created_at <= $2",[t.id,latest.created_at]);
  await note(db,t.opportunity_id,"Real Calendar availability checked; meeting slots offered. Waiting for explicit selection.");
}
async function handleReply(t:FunnelThread,o:NonNullable<Awaited<ReturnType<typeof getOpportunity>>>) {
  const db=getDb();const latest=(await db.query<FunnelMessage>("select * from funnel_messages where thread_id=$1 and direction='in' and analysed_at is null order by created_at desc,id desc limit 1",[t.id])).rows[0];
  if (!latest) return;
  if (latest.body.startsWith("[HTML/attachment-only")) {await updateState(t,"review","Reply has no readable plain text; human review needed.");return;}
  // The exact selection offered by us is deterministic consent, not an AI guessing task.
  // Ingestion already applies opt-out/decline checks before this step.
  const time=resolveMeetingTime(latest.body,t.offered_slots,new Date(latest.created_at),calendarPreferences());
  if(time.kind==='clarify') {
    await queueMessage(t,`reply-${latest.id}`,'scheduling_clarification',{subject:`Re: ${o.product_name} discussion`,body:`${time.reason}\n\nPlease include the date, time with AM/PM, and timezone (${calendarPreferences().timeZone} by default), or confirm one offered slot. No meeting has been booked yet.\n\nKind regards,\n${seller().name}`},latest.rfc_message_id);
    await updateState(t,'awaiting_time','Clarification sent; waiting for one agreed date and time.');
    await db.query("update funnel_messages set analysed_at=now() where thread_id=$1 and direction='in' and created_at <= $2",[t.id,latest.created_at]);
    return;
  }
  if(time.kind==='selected') {
    const connected=await calendarConnected();
    await db.query("update funnel_threads set state=$4,meeting_start=$2,meeting_checks=0,next_action_at=now(),reason='Agreed date/time; checking Calendar consent and availability',summary=summary || $3,updated_at=now() where id=$1",[t.id,time.start,`\nBuyer agreed to ${time.start}. Calendar availability will be rechecked.`,connected?'meeting_pending':'awaiting_calendar']);
    if(t.opportunity_id)await db.query("update search_opportunities set summary=summary || $2,next_action='Checking selected meeting time' where id=$1",[o.id,`\nBuyer agreed to ${time.start}; booking not yet confirmed.`]);
    await db.query("update funnel_messages set analysed_at=now() where thread_id=$1 and direction='in' and created_at <= $2",[t.id,latest.created_at]);
    await note(db,t.opportunity_id,"Buyer agreed to a specific meeting time; real Calendar booking queued after consent.");
    return;
  }
  const history=(await db.query<{direction:string;body:string}>("select direction,body from funnel_messages where thread_id=$1 and (state='accepted' or direction='in') order by created_at desc limit 8",[t.id])).rows.reverse();
  const decision=await analyseReply(o,history,latest.body);
  await db.query("update funnel_threads set summary=$2,updated_at=now() where id=$1",[t.id,decision.summary]);
  if(t.opportunity_id)await db.query("update search_opportunities set summary=$2,owner_name=$3 where id=$1",[o.id,decision.summary,seller().name]);
  if (decision.confidence<0.85 || decision.intent==="unknown") {await updateState(t,"review","AI is uncertain. Review the reply; no automatic email sent.");return;}
  if (["opt_out","rejected","auto_reply"].includes(decision.intent)) {
    if (decision.intent==="opt_out") {
      await db.query("insert into funnel_suppressions(recipient,reason) values ($1,'AI identified opt-out') on conflict do nothing",[AUTOMATION_RECIPIENT]);
      await db.query("update funnel_threads set state='stopped',reason='Recipient opted out',updated_at=now() where state<>'meeting_booked'");
      await db.query("update funnel_messages set state='cancelled' where direction='out' and state='queued'");
    } else await updateState(t,"stopped",`Reply classified as ${decision.intent}; no follow-ups.`);
  } else if (decision.intent==="meeting_request") {
    if(!await calendarConnected()) {
      await updateState(t,"awaiting_calendar","Meeting requested. Connect the approved Google Calendar in Email automation; this request resumes automatically after consent.",new Date(Date.now()+60_000));
      // Keep this real reply pending; no invented link and no repeated AI calls while waiting.
      return;
    }
    await offerMeetingSlots(t,o);return;
  } else {
    if (!decision.body.trim()) throw new Error("AI produced no usable reply. No automated email queued.");
    await queueMessage(t,`reply-${latest.id}`,"reply",{subject:`Re: ${o.product_name} discussion`,body:decision.body},latest.rfc_message_id);
    await updateState(t,"engaged","Reply prepared; prospecting follow-ups are stopped during this conversation.");
  }
  await db.query("update funnel_messages set analysed_at=now() where thread_id=$1 and direction='in' and created_at <= $2",[t.id,latest.created_at]);
}
async function advanceThread(t:FunnelThread) {
  if(t.recipient!==AUTOMATION_RECIPIENT)return;
  const o=await threadContext(t);
  if (!o || t.mode!=="email_test" && (o.is_sample || o.qualification==="rejected")) {await updateState(t,"stopped","Buyer fit rejected or sample data; automation blocked.");return;}
  if(t.state==="awaiting_calendar") {
    if(!await calendarConnected())return;
    if(t.meeting_start){await updateState(t,'meeting_pending','Calendar connected; checking the agreed meeting time.',new Date());return;}
    await offerMeetingSlots(t,o);return;
  }
  if(t.mode==="email_test" && t.state==="qualifying") {
    await queueMessage(t,`initial-${t.id}`,"initial",await initialEmail(o,{name:demoCustomer().name,title:"Demo customer — role-playing a buyer"}));
    await updateState(t,"active","Live test email queued; no real buyer qualification claimed.");return;
  }
  if (t.state==="qualifying") {
    if (o.qualification!=="approved") {
      const fit=await qualifyBuyer(o,{demoFallback:t.mode==='prospect_demo'});
      if (!fit.approved) {await updateState(t,"review",`Product fit was not established: ${fit.reason}`);return;}
      await updateOpportunity(o.id,{qualification:"approved"});
      await note(getDb(),o.id,`${fit.basis==='demo_evidence_fallback'?'Deterministic demo-only evidence check':'AI'} approved possible ${o.product_name} buyer fit with verified verbatim evidence: ${fit.reason}. Not a confirmed order or validated buyer contact.`);
    }
    if(t.mode==="prospect_demo") {
      const refreshed=await getOpportunity(o.id);
      if(!await approvedDemoOpportunity(refreshed)) {await updateState(t,"review","This search needs verified real-source evidence before a prospect demo can send.");return;}
      if(!refreshed)return;
      await queueMessage(t,`initial-${t.id}`,"initial",await initialEmail(refreshed,{name:demoCustomer().name,title:`Demo customer representing ${o.name}`}));
      await updateState(t,"active",`Demo email queued to ${AUTOMATION_RECIPIENT} for ${o.name}. No buyer contacted; contact validation is still separate.`);
      return;
    }
    await updateState(t,"needs_contact","Finding a named, role-reviewed, provider-validated contact.");
    t.state="needs_contact";
  }
  if (t.state==="needs_contact") {
    try {
      const contact=await prepareContact(o);
      const refreshed=await getOpportunity(o.id);
      if (!contact || !refreshed || !isVerified(refreshed)) throw new Error("Verified CRM contact requirements were not met.");
      await getDb().query("update funnel_threads set person_id=$2 where id=$1",[t.id,contact.id]);
      await queueMessage(t,`initial-${t.id}`,"initial",await initialEmail(refreshed,contact));
      await updateState(t,"active","Initial email queued automatically after product/contact checks.");
    } catch (e) {await updateState(t,"needs_contact",errorText(e),new Date(Date.now()+6*60*60_000));}
  } else if (t.state==="engaged") {
    await handleReply(t,o);
  } else if (t.state==="meeting_pending" && t.meeting_start) {
    if((t.meeting_checks??0)>=10){await updateState(t,'review','Google Meet link is still unavailable after ten checks. Inspect the existing Calendar event; no duplicate event will be created.');return;}
    let booked:Awaited<ReturnType<typeof bookDemoMeeting>>;
    try{booked=await bookDemoMeeting(t.id,t.meeting_start,o.product_name);}
    catch(error){if(error instanceof MeetingSlotUnavailableError){await offerMeetingSlots(t,o,true);return;}throw error;}
    await getDb().query('update funnel_threads set meeting_checks=meeting_checks+1 where id=$1',[t.id]);
    await getDb().query("update funnel_threads set event_id=$2,meet_url=$3,updated_at=now() where id=$1",[t.id,booked.id,booked.url]);
    if (!booked.url) {await updateState(t,"meeting_pending","Calendar event created; Google Meet link is still pending.",new Date(Date.now()+60_000));return;}
    const p=calendarPreferences();const when=new Intl.DateTimeFormat("en-GB",{timeZone:p.timeZone,dateStyle:"full",timeStyle:"short"}).format(new Date(t.meeting_start));
    const latest=(await getDb().query<{rfc_message_id:string|null}>("select rfc_message_id from funnel_messages where thread_id=$1 and direction='in' order by created_at desc limit 1",[t.id])).rows[0];
    await queueMessage(t,`meeting-${t.id}`,"meeting",{subject:`Meeting confirmed: ${o.product_name}`,body:`Our ${p.duration}-minute discussion is booked for ${when} (${p.timeZone}).\n\nGoogle Meet: ${booked.url}\n\nWe can review your ${o.product_name} requirements and next steps.\n\nKind regards,\n${seller().name}`},latest?.rfc_message_id??null);
    await updateState(t,"meeting_booked","Real calendar event and Google Meet link confirmed. Follow-ups stopped.");
    await note(getDb(),t.opportunity_id,`Demo meeting booked on ${AUTOMATION_RECIPIENT}'s Calendar: ${booked.url}. No real buyer invited.`);
    await getDb().query("update funnel_threads set summary=summary || $2 where id=$1",[t.id,`\nMeeting: ${when} (${p.timeZone}); ${booked.url}`]);
    if(t.opportunity_id)await getDb().query("update search_opportunities set summary=summary || $2,next_action='Meeting booked' where id=$1",[o.id,`\nMeeting: ${when} (${p.timeZone}); ${booked.url}`]);
  } else if (t.mode!=="email_test" && t.state==="active" && t.followups<MAX_FOLLOWUPS) {
    const history=(await getDb().query<{direction:string;kind:string;created_at:string}>("select direction,kind,created_at from funnel_messages where thread_id=$1 order by created_at",[t.id])).rows;
    if (history.some(m=>m.direction==="in") || !history.some(m=>m.kind==="initial")) return;
    const p=calendarPreferences();if (!businessTime(new Date(),p.timeZone,p.startHour,p.endHour)) return;
    const latest=history.at(-1);if (!latest || Date.now()-Date.parse(latest.created_at)<FOLLOWUP_DELAY_MS) return;
    await queueMessage(t,`followup-${t.id}-${t.followups+1}`,"followup",{subject:`Following up: ${o.product_name}`,body:`Hello,\n\nJust following up on my message about potential ${o.product_name} requirements at ${o.name}. Would a brief discussion be useful, or should I close this conversation?\n\nKind regards,\n${seller().name}`});
  } else if(t.state==="active" && t.followups>=MAX_FOLLOWUPS) {
    // Keep late genuine replies processable, but never schedule endless no-reply mail.
    await updateState(t,"review","Follow-up limit reached without a reply. Automatic follow-ups stopped.");
  }
}
async function deliverOne() {
  const db=getDb();const control=(await db.query<{enabled:boolean}>("select enabled from funnel_control where id=1")).rows[0];
  if (!control?.enabled || (await db.query("select recipient from funnel_suppressions where recipient=$1",[AUTOMATION_RECIPIENT])).rows.length) return;
  const candidate=(await db.query<FunnelMessage>(`select m.* from funnel_messages m join funnel_threads t on t.id=m.thread_id
    where m.direction='out' and m.state in ('queued','sending') and not t.paused and t.state in ('active','engaged','awaiting_time','meeting_pending','meeting_booked')
      and not exists(select 1 from funnel_messages incoming where incoming.thread_id=t.id and incoming.direction='in' and incoming.analysed_at is null)
      and t.recipient=$1 order by m.created_at limit 1`,[AUTOMATION_RECIPIENT])).rows[0];
  if (!candidate) return;
  const t=(await db.query<FunnelThread>("select * from funnel_threads where id=$1",[candidate.thread_id])).rows[0];
  const o=await threadContext(t);
  if(t.mode==="prospect_demo" && !await approvedDemoOpportunity(o)) {
    await updateState(t,"review","Potential buyer approval revoked; approved-inbox demo delivery blocked.");return;
  }
  if(t.mode==="prospect_demo" && candidate.kind==="initial" && !candidate.first_attempt_at && o){
    const previous=(await db.query<{count:number}>(`select count(distinct ft.id)::int as count from funnel_threads ft join search_opportunities other on other.id=ft.opportunity_id
      join funnel_messages sent on sent.thread_id=ft.id where other.run_id=$1 and ft.id<>$2 and sent.kind='initial' and sent.first_attempt_at is not null`,[o.run_id,t.id])).rows[0].count;
    if(previous>=prospectsPerSearch()){await updateState(t,"review","Demo delivery limit reached for this search; no extra inbox email sent.");return;}
  }
  if(t.mode==="buyer") {
  if (!o || !isVerified(o) || o.qualification!=="approved") {await updateState(t,"review","Buyer/contact approval was revoked or expired; delivery blocked.");return;}
  const contact=(await db.query(`select p.id from people p join contact_points cp on cp.person_id=p.id
    where p.id=$1 and p.current_company_id=$2 and p.confirmed_at>now()-interval '90 days'
      and cp.kind='email' and cp.verified_at>now()-interval '90 days' and cp.source like 'provider:%'
      and cp.value ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      and exists(select 1 from person_roles pr where pr.person_id=p.id and (pr.company_id=p.current_company_id or pr.company_id is null) and pr.end_date is null
        and case $3 when 'buyer' then pr.buying_role in ('procurement_lead','package_manager') when 'decision_maker' then pr.buying_role in ('decision_maker','executive')
        when 'approver' then pr.buying_role in ('decision_maker','project_director') when 'technical_approver' then pr.buying_role in ('technical_evaluator','discipline_lead')
        when 'influencer' then pr.buying_role in ('project_director','package_manager') else false end)`,[t.person_id,t.company_id,o.contact_role])).rows[0];
  if (!contact) {await updateState(t,"review","The selected person's role/email validation was revoked or expired. Another validated contact cannot authorize this person's email.");return;}
  }
  if (candidate.attempts>=3 || candidate.first_attempt_at && Date.now()-Date.parse(candidate.first_attempt_at)>=23*60*60_000) {
    await db.query("update funnel_messages set state='review',error='Uncertain acceptance or expired duplicate-protection window; inspect Resend before retrying' where id=$1",[candidate.id]);
    await updateState(t,"review","Delivery requires review; no new email was sent.");return;
  }
  await db.tx(async tx=>{
    // Same advisory lock as manual/legacy delivery: parallel paths cannot exceed the cap.
    await tx.query("select pg_advisory_xact_lock(78240321)");
    if (!candidate.first_attempt_at && await demoAttemptsToday(tx)>=DEMO_DAILY_LIMIT) throw new Error("Combined demo delivery cap reached (10/day). No new email sent.");
    await tx.query("update funnel_messages set state='sending',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) where id=$1",[candidate.id]);
  });
  try {
    const sent=await sendFunnelMessage({...candidate,reply_to:candidate.reply_to!});
    await db.tx(async tx=>{
      await tx.query("update funnel_messages set state='accepted',provider_id=$2,error=null where id=$1",[candidate.id,sent.id]);
      await tx.query(`update funnel_threads set next_action_at=now()+interval '3 days',followups=followups+case when $2='followup' then 1 else 0 end,updated_at=now() where id=$1`,[t.id,candidate.kind]);
      await note(tx,t.opportunity_id,`Provider accepted ${candidate.kind} email to ${AUTOMATION_RECIPIENT}; inbox delivery not yet verified (provider ${sent.id}).`);
    });
  } catch (e) {
    await db.query("update funnel_messages set state='queued',error=$2 where id=$1 and state='sending'",[candidate.id,errorText(e)]);
    throw new Error("Delivery acceptance was uncertain. The same frozen message/key will be retried at most three times, never a fresh duplicate.");
  }
}
/** Durable single-worker lease spans provider I/O; no transaction is held while calling APIs. */
export async function processFunnelTick():Promise<{processed:boolean;enrolled?:number;inbound?:number}> {
  const db=getDb();
  if (!(await db.query<{enabled:boolean}>("select enabled from funnel_control where id=1")).rows[0]?.enabled) {
    await db.query('update funnel_control set last_tick_at=now() where id=1 and not enabled');
    return {processed:false};
  }
  requireFunnelConfig();const lease=randomUUID();
  const claimed=await db.query("update funnel_control set worker_lease=$1,worker_until=now()+interval '20 minutes' where id=1 and enabled and (worker_until is null or worker_until<=now()) returning id",[lease]);
  if (!claimed.rows.length) return {processed:false};
  try {
    const inbound=await ingestInbox();const enrolled=await enrollCompletedSearches();
    if ((await db.query("select recipient from funnel_suppressions where recipient=$1",[AUTOMATION_RECIPIENT])).rows.length) return {processed:true,enrolled,inbound};
    const threads=(await db.query<FunnelThread>(`select * from funnel_threads where not paused and state not in ('stopped','meeting_booked','review','awaiting_time')
      and next_action_at<=now() and recipient=$1 order by next_action_at limit 1`,[AUTOMATION_RECIPIENT])).rows;
    for (const t of threads) {
      try {await advanceThread(t);} catch(e) {await updateState(t,"review",errorText(e));await note(db,t.opportunity_id,`Automation needs review: ${errorText(e)}`);}
    }
    await deliverOne();
    await db.query("update funnel_control set last_tick_at=now(),last_error=null where id=1 and worker_lease=$1",[lease]);
    return {processed:true,enrolled,inbound};
  } catch(e) {
    await db.query("update funnel_control set last_tick_at=now(),last_error=$2 where id=1 and worker_lease=$1",[lease,errorText(e)]);
    throw e;
  } finally {await db.query("update funnel_control set worker_until=null,worker_lease=null where id=1 and worker_lease=$1",[lease]);}
}
