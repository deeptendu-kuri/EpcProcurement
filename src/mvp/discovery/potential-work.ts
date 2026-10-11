import type {SearchBrief} from './brief';
import {matchUse} from './brief';
import {materialOutputOnly} from './plan';
import {originalQuote} from './evidence';
import {namesCompany} from '@/mvp/research/need';

/** Reviewed application knowledge, NOT proof of a material order. Deliberately
 * bounded to the stainless-process-pipe false negatives observed in the live
 * audit. Unknown products/packages continue to require the existing need check.
 * Never borrow a neighbouring contractor's package from a multi-company quote. */
export function stainlessApplicationProof(proof:{company:string;quote:string;text:string;package?:string|null},brief:SearchBrief):{use:string;quote:string}|null {
  if(brief.productId!=='ss-duplex-pipe'||!originalQuote(proof.text,proof.quote)||materialOutputOnly(proof.quote,brief.productId))return null;
  const clauses=proof.quote.split(/\s+(?:while|whereas|but)\s+|;\s*/i);
  const own=clauses.filter(c=>namesCompany(c,proof.company));
  // Own-company report bullets may omit the name. Attribution is checked by
  // judgeNeed/supportedWorkProof; never use a nameless half of a shared paragraph.
  const scope=own.length?own.join(' '):clauses.length===1?proof.quote:'';
  if(!scope||/\b(?:HDPE|polyethylene|PVC|GRP|GRE|ductile iron|transmission pipelines?|cross[- ]country pipelines?|jetty|jetties|dredging)\b/i.test(scope))return null;
  const rules:[RegExp,string][]=[
    [/\b(?:gas processing|LNG.{0,100}(?:plant|facility|terminal|export|liquef)|NGL.{0,60}(?:plant|train|fractionation)|compression facilities|pre[- ]conditioning plant)\b/i,'oil & gas processing plant'],
    [/\b(?:chemical|petrochemical)\s+(?:process\s+)?(?:plant|complex)|\brefiner(?:y|ies)\b/i,'chemical process plant'],
    [/\b(?:food|pharmaceutical|brewery|fermentation)\b.{0,60}\b(?:plant|process|production)\b/i,'food and pharmaceutical process plant'],
  ];
  // Resolve an abbreviation only when it is in this company's own work and its
  // literal definition exists on the same stored page (e.g. LPP at Habshan).
  const definedLpp=/\bLPP\b/.test(scope)&&/\bLNG pre[- ]conditioning plant \(LPP\)/i.test(proof.text);
  const name=definedLpp?'oil & gas processing plant':rules.find(([r])=>r.test(scope))?.[1];
  const use=name?matchUse(brief,name)?.name??null:null;
  const quote=definedLpp?proof.text.split(/\n+/).find(p=>/\bLNG pre[- ]conditioning plant \(LPP\)/i.test(p))!
    :originalQuote(proof.text,scope)??originalQuote(proof.text,proof.quote)!;
  return use?{use,quote}:null;
}

export function stainlessWorkApplication(proof:{company:string;quote:string;text:string;package?:string|null},brief:SearchBrief):string|null {
  return stainlessApplicationProof(proof,brief)?.use??null;
}

/** Only a missing-material/specification rationale can be corrected by reviewed
 * application knowledge. An explicit incompatibility or unrelated use cannot. */
export function missingMaterialOnly(reason:string):boolean {
  return /(?:does not|doesn't|not|no|without|lack|absen|unspecified|unclear).{0,65}(?:specif|mention|explicit|material|grade|pipe)|(?:material|grade|pipe).{0,50}(?:not (?:specif|mention)|unspecified|unknown)/i.test(reason)
    && !/\b(?:incompatible|different material|does not require|doesn't require|not needed|not suitable|sewage|water network|design only|engineering only|civil only)\b/i.test(reason);
}

/** Keep model interpretation out of fact wording. This is an engineering
 * inference; specifications and purchasing status are explicitly unconfirmed. */
export function potentialBuyingReason(quote:string,label:string,use:string|null):string {
  return `${quote} Why it may need ${label}: ${potentialNeedReason(use)}`;
}

export function potentialNeedReason(use:string|null):string {
  return `Its ${use??'material-consuming'} work is a potential application for this product. Exact specification, quantity and purchasing status are unconfirmed.`;
}
