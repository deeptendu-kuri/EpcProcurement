const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
/** A literal publication dateline, not any four-digit year in a project story.
 * The reader's metadata wins. Plain date headings and corporate PDF datelines
 * are a fallback; dates in sentences, navigation links and forecasts aren't. */
export function pagePublishedAt(text:string,metadata:string|null):string|null {
  if(metadata)return metadata;
  return publicationDateProof(text)?.date??null;
}

/** Preserve a publication dateline separately from the work paragraph. The
 * page's publication date is never silently relabelled as its contract date. */
export function publicationDateProof(text:string):{date:string;quote:string}|null {
  for(const line of text.split(/\n+/)){
    const normalized=line.trim().replace(/^.{0,90}\(BUSINESS WIRE\)--/,'').replace(/\b([A-Za-z]{3})\./g,'$1');
    const match=normalized.match(/^(?:(?:[\p{L} .-]{2,35}),\s*)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})(?:\s*[:–—-]|\s*$)/u)
      ??normalized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})(?:\s*[:–—-]|\s*$)/u);
    if(!match)continue;
    const monthWord=/^\d+$/.test(match[1])?match[2]:match[1],day=Number(/^\d+$/.test(match[1])?match[1]:match[2]);
    const month=MONTHS.findIndex(m=>m.startsWith(monthWord.toLowerCase())),year=Number(match[3]);
    if(month<0||day<1||day>31)continue;
    const date=new Date(Date.UTC(year,month,day));
    if(date.getUTCMonth()===month&&date.getUTCDate()===day)return {date:date.toISOString(),quote:line.trim()};
  }
  return null;
}
