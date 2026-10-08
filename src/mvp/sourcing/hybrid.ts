/** Durable hybrid analysis adapters; never collect sources, enrich contacts or send mail here. */
import type { Db, Queryable } from '@/mvp/db';
import type { RunInput } from '@/mvp/types';
import type { RawDoc } from '@/mvp/pipeline/contracts';
import type { Trigger } from '@/mvp/buyers/types';
import { getLLM, type LLMProvider, type LLMRole } from '@/mvp/llm';
import { originalQuote } from '@/mvp/discovery/evidence';
import { buyerPageCandidate } from '@/mvp/discovery/plan';
import { reserveAnalysis, reserveBudget, markBudget, type ResearchBudget } from '@/mvp/research/store';
import { isJsonGenerationError,JSON_ONLY_INSTRUCTION } from '@/mvp/llm/groq';

/** Initial routing, replaced by the richer deterministic classifier in WP2. */
export function needsAwardAnalysis(raw: RawDoc, text: string, input: RunInput): boolean {
  return Boolean(raw.structured) || buyerPageCandidate(text, input.productId ?? '') &&
    /\b(?:awards?|awarded|wins?|won|secures?|secured|bags?|orders?|tenders?|letter of award)\b/i.test(`${raw.title ?? ''}\n${text.slice(0, 900)}`);
}

/** Each P1/P2/P3 and comparison call spends the same counters as discovery.
 * Reservations remain conservative after provider errors: uncertain calls are never silently repeated.
 */
export function budgetedAwardProviders(db: Db, runId: string, documentId: string, budget: ResearchBudget,
  make: (role: LLMRole, model?: string) => LLMProvider = (role, model) => getLLM(role, db, model)) {
  let limited = false;
  return {
    get limited() { return limited; },
    provider(role: LLMRole, model?: string): LLMProvider {
      const llm = make(role, model);
      if (llm.name === 'mock') return llm; // deterministic fixtures cost no provider quota
      const wrapped:LLMProvider = { ...llm, async complete(request) {
        const key = `award:${documentId}:${role}:${llm.model}:${request.purpose ?? 'extract'}`;
        const tokens = Math.ceil((request.system.length + request.user.length) / 3) + (request.maxTokens ?? 1500);
        const reservation = await reserveAnalysis(db, runId, key, tokens, budget);
        if (reservation !== 'reserved') {
          limited = true;
          throw new Error(reservation === 'exhausted' ? 'Shared research AI budget exhausted.' : 'Prior award provider acceptance is uncertain; no repeated paid call.');
        }
        try {
          const result = await llm.complete({ ...request, singleAttempt: true, runId });
          await markBudget(db, runId, 'ai_pages', key, 'completed');
          await markBudget(db, runId, 'ai_tokens', key, 'completed');
          return result;
        } catch (error) {
          await markBudget(db, runId, 'ai_pages', key, 'unknown');
          await markBudget(db, runId, 'ai_tokens', key, 'unknown');
          if(request.json&&!request.purpose?.endsWith(':json-repair')&&isJsonGenerationError(error)){
            const repair=await reserveBudget(db,runId,'json_repairs',key,1,budget.maxRepairCalls);
            if(repair==='reserved')return wrapped.complete({...request,system:`${request.system}\n\n${JSON_ONLY_INSTRUCTION}`,purpose:`${request.purpose??'extract'}:json-repair`});
          }
          throw error;
        }
      }};
      return wrapped;
    },
  };
}

interface Proof { id: string; quote: string; text: string; field: string; }
/** Transitional, evidence-linked job snapshots. WP5 persists these in company_triggers.
 * Recheck stored originals, even if an older evidence row claims quote_verified.
 */
export async function awardTriggerSnapshots(db: Queryable, documentId: string): Promise<Trigger[]> {
  const parties = (await db.query<{id:string;role:string;project_id:string;name:string;owner_name:string|null;country:string|null;award_date:string|null;value_usd:number|null;stage:string}>(`
    select distinct pp.id,pp.role,pp.project_id,p.name,c.canonical_name as owner_name,p.country,pp.award_date,pp.value_usd,p.current_stage as stage
    from project_parties pp join projects p on p.id=pp.project_id left join companies c on c.id=p.owner_company_id
    join fact_evidence fe on fe.entity_type='project_party' and fe.entity_id=pp.id and fe.field='role'
    join evidence e on e.id=fe.evidence_id where e.document_id=$1 and e.quote_verified=true
      and pp.role in ('main_epc','consortium_member','subcontractor','supplier')`, [documentId])).rows;
  const triggers: Trigger[] = [];
  for (const party of parties) {
    const proofs = (await db.query<Proof>(`select e.id,e.quote,d.text,fe.field from fact_evidence fe
      join evidence e on e.id=fe.evidence_id join source_documents d on d.id=e.document_id
      where fe.entity_type='project_party' and fe.entity_id=$1 and e.document_id=$2 and e.quote_verified=true`, [party.id, documentId])).rows
      .filter(p => originalQuote(p.text, p.quote) !== null);
    const role = proofs.find(p => p.field === 'role');
    if (!role || !['awarded','procurement','construction','epc_tender','prequalification'].includes(party.stage)) continue;
    const date = proofs.some(p => p.field === 'award_date') ? party.award_date : null;
    const value = proofs.find(p => p.field === 'contract_value');
    triggers.push({id:party.id,kind:party.role==='subcontractor'?'subcontract':party.role==='supplier'?'order':
      ['epc_tender','prequalification'].includes(party.stage)?'tender':'award',
      role:party.role==='subcontractor'?'subcontractor':party.role==='supplier'?'supplier':'contractor',title:role.quote,
      date,datePrecision:date?'day':'unknown',valueUsd:value?party.value_usd:null,valueText:value?.quote??null,
      country:party.country,projectId:party.project_id,projectName:party.name,ownerName:party.owner_name,
      strength:'confirmed',evidenceIds:[...new Set(proofs.map(p=>p.id))]});
  }
  return triggers;
}

export async function capabilityTriggerSnapshots(db: Queryable, runId: string, productId: string, documentIds: string[]): Promise<Trigger[]> {
  const rows = (await db.query<{id:string;company_id:string;buying_reason:string;evidence_ids:string[]}>(`
    select o.id,o.company_id,o.buying_reason,o.evidence_ids from search_opportunities o
    where o.run_id=$1 and o.product_id=$2 and exists(select 1 from evidence e
      where e.id=any(o.evidence_ids) and e.document_id=any($3::uuid[]) and e.quote_verified=true)`, [runId,productId,documentIds])).rows;
  const out: Trigger[] = [];
  for (const row of rows) {
    const proofs=(await db.query<Proof>(`select e.id,e.quote,d.text,'' as field from evidence e join source_documents d on d.id=e.document_id
      where e.id=any($1::uuid[]) and e.document_id=any($2::uuid[]) and e.quote_verified=true`,[row.evidence_ids,documentIds])).rows.filter(p=>originalQuote(p.text,p.quote)!==null);
    if(!proofs.length)continue;
    out.push({id:row.id,kind:'capability',role:'contractor',title:proofs[0].quote,date:null,datePrecision:'unknown',valueUsd:null,
      valueText:null,country:null,projectId:null,projectName:null,ownerName:null,strength:'possible',evidenceIds:proofs.map(p=>p.id)});
  }
  return out;
}
