import type { Queryable } from '@/mvp/db';
import type { SearchBrief } from './brief';
import { namesWork } from './brief';
import { materialOutputOnly } from './plan';
import { originalQuote } from './evidence';
import { sameCompanyName } from '@/mvp/research/company-names';
import { namesCompany } from '@/mvp/research/need';
import { articleAnalysisText } from '@/mvp/research/relevance';

/** A work check is inference, not proof of a purchase/specification. Recheck the
 * stored source before BOTH lead saving and demo qualification use that inference. */
export function supportedWorkProof(proof:{company:string;quote:string;text:string;package?:string|null},
  productId:string,brief:SearchBrief):boolean {
  const quote=originalQuote(proof.text,proof.quote);
  if(!quote||!namesCompany(quote,proof.company)||materialOutputOnly(quote,productId))return false;
  // The company-attributed contract sentence may refer to a plant described in
  // its neighbouring paragraph. Context informs application; it is not RFQ proof.
  const body=articleAnalysisText(proof.text);
  const at=body.indexOf(quote);
  const context=at>=0?body.slice(Math.max(0,at-400),at+quote.length+700):quote;
  if(!namesWork(quote,brief)&&!namesWork(context,brief))return false;
  // Do not convert a contractor's explicitly different pipe package into demand.
  const scope=`${quote} ${proof.package??''}`;
  const otherPipe:Record<string,RegExp>={
    'hdpe-pipe':/\b(?:GRP|GRE|fiberglass|glass reinforced|ductile iron|steel pipes?|steel pipelines?)\b/i,
    'ss-duplex-pipe':/\b(?:HDPE|polyethylene|PVC|GRP|GRE|ductile iron)\b/i,
    'line-pipe':/\b(?:HDPE|polyethylene|PVC|GRP|GRE|ductile iron)\b/i,
  };
  return !otherPipe[productId]?.test(scope);
}

/** Only same-run, same-company accepted need checks, never a freeform CRM reason. */
export async function workProofEvidence(db:Queryable,o:{run_id:string;product_id:string;name:string},
  quotes:{id:string;document_id?:string|null;quote:string;text:string|null;own_run:boolean}[]):Promise<Set<string>> {
  const run=(await db.query<{adhoc_query:{productId?:string;brief?:SearchBrief}|null}>('select adhoc_query from runs where id::text=$1',[o.run_id])).rows[0];
  const brief=run?.adhoc_query?.brief;
  if(run?.adhoc_query?.productId!==o.product_id||brief?.source!=='ai')return new Set();
  const checks=(await db.query<{company_name:string;document_id:string;quote:string;package:string|null}>(
    "select company_name,document_id,quote,package from need_checks where run_id=$1 and verdict='lead' and quote_verified=true and needs_item='yes' and role in ('epc','jv_partner','subcontractor','maintenance_contractor')",[o.run_id])).rows;
  return new Set(quotes.filter(q=>q.own_run&&q.text&&checks.some(n=>n.document_id===q.document_id&&sameCompanyName(n.company_name,o.name)
    &&originalQuote(n.quote,q.quote)&&supportedWorkProof({company:o.name,quote:q.quote,text:q.text!,package:n.package},o.product_id,brief))).map(q=>q.id));
}
