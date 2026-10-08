/** Recover original quote spans, never invented/paraphrased evidence. */
export function originalQuote(text:string,quote:string):string|null {
  if(!quote.trim())return null;
  if(text.includes(quote))return quote;
  const pattern=quote.trim().split(/\s+/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")
    .replace(/[‘’']/g,"[‘’']").replace(/[“”\"]/g,'[“”"]')).join("\\s+");
  return text.match(new RegExp(pattern,"i"))?.[0]??null;
}
export function companyNames(company:string,identityQuote:string):string[] {
  const names=[company];
  const full=company.replace(/\s*\([A-Z0-9&.-]{2,12}\)\s*$/," ").trim();
  if(full!==company && identityQuote.toLowerCase().includes(full.toLowerCase()))names.push(full);
  // A reported short legal name is not an invented acronym or another company.
  const short=full.replace(/(?:[,.]?\s+(?:pvt\.?|private|ltd\.?|limited|inc\.?|incorporated|llc|plc|corporation|corp\.?))+\s*$/i,"").trim();
  if(short!==full&&short.split(/\s+/).length>=2&&short.length>=6&&identityQuote.toLowerCase().includes(full.toLowerCase()))names.push(short);
  // An acronym is allowed only when the original company identity explicitly defines it.
  const escaped=full.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const acronym=identityQuote.match(new RegExp(escaped+"\\s*\\(([A-Z0-9&.-]{2,12})\\)"))?.[1];
  if(acronym)names.push(acronym);
  return [...new Set(names)];
}
export function namesCompany(text:string,names:string[]):boolean {
  return names.some(name=>{
    const tokens=name.match(/[\p{L}\p{N}]+/gu)??[];
    if(!tokens.length)return false;
    // Only typography varies: every name token, including legal suffixes, stays present.
    const pattern=tokens.map(token=>token.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("[^\\p{L}\\p{N}]*");
    return new RegExp("(?<![\\p{L}\\p{N}])"+pattern+"(?![\\p{L}\\p{N}])","iu").test(text);
  });
}
/** Reject explicit, competing grammatical subjects; an article is not one company's scope. */
export function otherWorkSubject(text:string,names:string[]):boolean {
  const subjects=text.matchAll(/(?:^|[.!?\n]\s*)([A-Z][\w&.-]+(?:\s+[A-Z][\w&.-]+){0,7})\s+(?:is|are|undertakes?|constructs?|installs?|fabricates?|secured|won|executes?|provides?|performs?)\b/g);
  for(const match of subjects){
    if(/^(?:We|Our|It|The Company)$/.test(match[1]))continue;
    if(!namesCompany(match[1],names))return true;
  }
  return false;
}
/** A short scope excerpt can safely reuse the company claim that literally contains it. */
export function attributedScope(text:string,quote:string,identityQuote:string,names:string[]):string|null {
  const source=originalQuote(text,quote);
  if(!source)return null;
  if(otherWorkSubject(source,names))return null;
  if(namesCompany(source,names))return source;
  if(identityQuote.includes(source))return otherWorkSubject(identityQuote,names)?null:identityQuote;
  // Resolve a single adjacent pronoun-led continuation, not arbitrary page-wide scope.
  // A named second company breaks attribution, even if the selected company is elsewhere.
  const start=text.indexOf(source);
  const before=text.slice(Math.max(0,start-2000),start);
  const paragraphs=before.trimEnd().split(/\n\s*\n/);
  const previous=paragraphs.at(-1)??"";
  if (/^\s*(?:we\b|our\b|it\b|the company\b)/i.test(source)
      && previous.endsWith(identityQuote) && identityQuote.length+source.length<=4000) {
    const identityStart=text.lastIndexOf(identityQuote,start);
    if(identityStart<0||text.slice(identityStart+identityQuote.length,start).trim())return null;
    const span=text.slice(identityStart,start+source.length);
    if(namesCompany(span,names))return span;
  }
  return null;
}
/** Headquarters/base evidence can span adjacent sentences, but cannot borrow another party's location. */
export function attributedCountry(text:string,quote:string,identityQuote:string,names:string[]):string|null {
  const source=originalQuote(text,quote);
  if(!source)return null;
  if(namesCompany(source,names))return source;
  if(identityQuote.includes(source))return identityQuote;
  // Sentence splitting does not treat Ltd./Pvt./Co. suffixes as attribution boundaries.
  const sentences=text.match(/[^\n]+?(?:[.!?](?=\s+[A-Z]|$)|\n|$)/g)??[];
  for(let i=0;i<sentences.length;i++){
    const sentence=sentences[i];
    if(!sentence.includes(source))continue;
    if(namesCompany(sentence,names)&&sentence.length<=1200)return sentence;
    const previous=sentences[i-1];
    const pronoun=/^\s*(?:(?:According to|As per)[^,]{0,100},\s*)?(?:the company\b|it\b|the [\w-]+-headquartered\b|the [\w-]+-based\b)/i;
    if(previous && namesCompany(previous,names) && pronoun.test(sentence)
      && /\b(?:headquartered|based|registered|incorporated)\b/i.test(sentence)){
      const span=previous+sentence;
      if(span.length<=1200 && text.includes(span))return span;
    }
  }
  return null;
}
