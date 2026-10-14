/** Inspect original, company-attributed clauses, not a model's package label.
 * Design/FEED alone is not authority to procure material. Another contractor's
 * construction in the same paragraph must not turn a designer into an EPC. */
export function engineeringOnlySource(quote:string,ownsClause:(clause:string)=>boolean=()=>true):boolean {
  const clauses=quote.split(/(?<=[.!?])\s+(?=[A-Z])|\s+(?:while|whereas|but)\s+|;\s*/);
  const own=clauses.filter(ownsClause);
  const scope=own.length?own:clauses.length===1?clauses:[];
  // Claims audit, 14 Oct: "engineering and project execution services" (KBR, Marjan) and "on-site supervision and
  // commissioning" (XPLOIL) were saved as buyers; services on a plant buy no equipment.
  const design=/\b(?:FEED|pre[- ]?FEED|front[- ]end engineering|detailed engineering|basic engineering|design contract|engineering(?: and [a-z ]{1,30}?)? services|engineering contract|consultancy|supervision|commissioning (?:services|support|assistance)|inspection services|third[- ]party inspection)\b/i;
  const physical=/\b(?:EPC|procurement|construct(?:ion|s|ing)?|install(?:ation|s|ing)?|fabricat(?:ion|es|ing)|maintenance)\b/i;
  return scope.some(clause=>design.test(clause)&&!physical.test(clause));
}

/** A polyethylene manufacturing unit makes polymer; that is not evidence that
 * its process piping is polyethylene. Reject explicit alternative PIPE scope,
 * not the plant's manufactured output. */
export function otherStainlessPipe(scope:string):boolean {
  return /\b(?:HDPE|polyethylene|PVC|GRP|GRE|ductile iron)\b[^.;\n]{0,40}\b(?:pipes?|piping|pipelines?|networks?)\b/i.test(scope);
}
