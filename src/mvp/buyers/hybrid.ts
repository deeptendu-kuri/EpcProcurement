/** Add verified trigger projections to the existing cross-search records; no research side effects. */
import type {Queryable} from '@/mvp/db';
import {strongestTrigger,triggersForCompany,triggerStageCap} from '@/mvp/sourcing/triggers';
import type {BuyerRecord} from './view';
import {capabilityLabel} from '@/mvp/discovery/locations';
export async function hybridSearchRecords(records:BuyerRecord[],db:Queryable):Promise<BuyerRecord[]>{
  const scopes=(await db.query<{id:string;client_product_ids:string[]}>('select id,client_product_ids from leads where id=any($1::uuid[])',[records.map(r=>r.view.leadId)])).rows;
  const byLead=new Map<string,Awaited<ReturnType<typeof triggersForCompany>>>();
  for(const r of records){
    const products=scopes.find(s=>s.id===r.view.leadId)?.client_product_ids??[];
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
