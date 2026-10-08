import { randomUUID } from 'node:crypto';
import { getDb,type Db } from '@/mvp/db';
import { serverlessRuntime } from '@/mvp/runtime';
/** Explicit cloud publishing opt-in. Serverless execution remains fail-closed until proven. */
export function transportConfigured(){return process.env.MVP_RESEARCH_TRANSPORT==='qstash'&&Boolean(process.env.QSTASH_TOKEN?.trim()&&process.env.APP_URL?.startsWith('https://'));}
export async function dispatchResearchOutbox(db:Db=getDb(),fetcher:typeof fetch=fetch) {
  if(!transportConfigured()||serverlessRuntime())return {published:0,configured:transportConfigured(),blocked:serverlessRuntime()};
  const token=randomUUID();
  const entry=await db.tx(async tx=>{
    const row=(await tx.query<{id:string;run_id:string|null;job_id:string|null;kind:string}>(`select o.* from research_outbox o
      where o.kind='research' and o.available_at<=now() and (o.state='pending' or o.state='publishing' and o.lease_until<now())
      and exists(select 1 from research_sessions s where s.run_id=o.run_id and s.state='active')
      and exists(select 1 from research_jobs j where j.id=o.job_id and j.state='queued')
      order by o.created_at for update skip locked limit 1`)).rows[0];
    if(row)await tx.query(`update research_outbox set state='publishing',lease_token=$2,lease_until=now()+interval '1 minute',attempts=attempts+1 where id=$1`,[row.id,token]);return row;
  });
  if(!entry)return {published:0,configured:true,blocked:false};
  try{
    const url=new URL('/api/mvp/research/worker',process.env.APP_URL!);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Invalid worker origin.');
    const res=await fetcher(`https://qstash.upstash.io/v2/publish/${url.toString()}`,{method:'POST',redirect:'error',headers:{authorization:`Bearer ${process.env.QSTASH_TOKEN}`,'content-type':'application/json','Upstash-Deduplication-Id':entry.id,'Upstash-Retries':'2'},body:JSON.stringify({runId:entry.run_id,jobId:entry.job_id}),signal:AbortSignal.timeout(15_000)});
    if(!res.ok)throw new Error('Transport publish failed.');
    const data=await res.json() as {messageId?:string};if(!data.messageId)throw new Error('Transport acceptance uncertain.');
    await db.query(`update research_outbox set state='published',provider_id=$3,lease_token=null,lease_until=null,error=null where id=$1 and lease_token=$2`,[entry.id,token,data.messageId]);
    return {published:1,configured:true,blocked:false};
  }catch{
    await db.query(`update research_outbox set state='pending',available_at=now()+interval '1 minute',lease_token=null,lease_until=null,error='Transport publication failed or uncertain; stable key retained.' where id=$1 and lease_token=$2`,[entry.id,token]);
    return {published:0,configured:true,blocked:false};
  }
}
export async function recordResendReceipt(id:string,type:string,resourceId:string|null,db:Db=getDb()) {
  return db.tx(async tx=>{
    const inserted=(await tx.query(`insert into provider_webhook_receipts(provider,event_id,event_type,resource_id) values('resend',$1,$2,$3) on conflict do nothing returning event_id`,[id,type,resourceId])).rows.length>0;
    if(inserted&&type==='email.received')await tx.query(`insert into research_outbox(kind,dedupe_key) values('funnel',$1) on conflict do nothing`,[`resend:${id}`]);
    return inserted;
  });
}
/** Wake existing inbox reconciliation; receipt acknowledgement itself never writes an AI reply. */
export async function processFunnelWake(db:Db=getDb(),tick?:()=>Promise<{processed:boolean;inbound?:number}>) {
  if(serverlessRuntime()||!['on','external'].includes(process.env.MVP_FUNNEL_WORKER??''))return {processed:false};
  const token=randomUUID();
  const entry=await db.tx(async tx=>{
    const row=(await tx.query<{id:string;dedupe_key:string}>(`select id,dedupe_key from research_outbox where kind='funnel' and available_at<=now()
      and (state='pending' or state='publishing' and lease_until<now()) order by created_at for update skip locked limit 1`)).rows[0];
    if(row)await tx.query(`update research_outbox set state='publishing',lease_token=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=$1`,[row.id,token]);return row;
  });
  if(!entry)return {processed:false};
  try{
    const reconcile=tick??(await import('@/mvp/automation/engine')).processFunnelTick;
    const result=await reconcile();
    if(!result.processed||typeof result.inbound!=='number')throw new Error('Inbox reconciliation not completed.');
    await db.tx(async tx=>{
      const updated=(await tx.query(`update research_outbox set state='published',lease_token=null,lease_until=null,error=null where id=$1 and lease_token=$2 returning id`,[entry.id,token])).rows.length;
      if(updated)await tx.query(`update provider_webhook_receipts set processed_at=now() where provider='resend' and event_id=$1`,[entry.dedupe_key.slice('resend:'.length)]);
    });
    return {processed:true};
  }catch{
    await db.query(`update research_outbox set state='pending',available_at=now()+interval '1 minute',lease_token=null,lease_until=null,error='Inbox reconciliation pending; receipt retained.' where id=$1 and lease_token=$2`,[entry.id,token]);
    return {processed:false};
  }
}
