/** Add verified trigger projections to the existing cross-search records; no research side effects. */
import type {Queryable} from '@/mvp/db';
import {strongestTrigger,triggersForCompany,triggerStageCap} from '@/mvp/sourcing/triggers';
import type {BuyerRecord} from './view';
import {capabilityLabel} from '@/mvp/discovery/locations';
export async function hybridSearchRecords(records:BuyerRecord[],db:Queryable):Promise<BuyerRecord[]>{
  const uuid=(id:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const leadOf=(r:BuyerRecord)=>r.derived?.rootLeadId??r.view.leadId;
  const scopes=(await db.query<{id:string;client_product_ids:string[]}>('select id,client_product_ids from leads where id=any($1::uuid[])',[[...new Set(records.map(leadOf).filter(uuid))]])).rows;
  const byLead=new Map<string,Awaited<ReturnType<typeof triggersForCompany>>>();
  for(const r of records){
    if(!uuid(r.view.companyId)){byLead.set(r.view.leadId,[]);continue;}
    const products=scopes.find(s=>s.id===leadOf(r))?.client_product_ids??[];
    const all=products.length? (await Promise.all(products.map(p=>triggersForCompany(db,r.view.companyId,undefined,p)))).flat():await triggersForCompany(db,r.view.companyId);
    byLead.set(r.view.leadId,all);
  }
  return records.map(r=>{
    // Existing records may predate product-scoped opportunities. No trigger is manufactured for them.
    const trigger=strongestTrigger(byLead.get(r.view.leadId)??[]);
    if(!trigger)return {...r,row:{...r.row,trigger:null}};
    const stage=triggerStageCap(trigger,r.view.stage);
    const whatTheyDo=r.view.sellItems.map(p=>capabilityLabel(p.itemId,trigger.title)).find(Boolean)??'';
    return {...r,siteCountry:trigger.country??r.siteCountry,valueUsd:trigger.valueUsd??r.valueUsd,
      view:{...r.view,whatTheyDo,stage,triggerDate:trigger.date,buyingReason:trigger.title},
      row:{...r.row,whatTheyDo,trigger,stage,triggerDate:trigger.date,buyingReason:trigger.title}};
  });
}
