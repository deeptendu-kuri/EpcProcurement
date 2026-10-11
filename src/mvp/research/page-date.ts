const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december'];
/** A literal publication dateline, not any four-digit year in a project story.
 * The reader's metadata wins. Plain date headings and corporate PDF datelines
 * are a fallback; dates in sentences, navigation links and forecasts aren't. */
export function pagePublishedAt(text:string,metadata:string|null):string|null {
  if(metadata)return metadata;
  for(const line of text.split(/\n+/)){
    const match=line.trim().match(/^(?:(?:[\p{L} .-]{2,35}),\s*)?([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d{2})(?:\s*[:–—-]|\s*$)/u)
      ??line.trim().match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})(?:\s*[:–—-]|\s*$)/u);
    if(!match)continue;
    const monthWord=/^\d+$/.test(match[1])?match[2]:match[1],day=Number(/^\d+$/.test(match[1])?match[1]:match[2]);
    const month=MONTHS.findIndex(m=>m.startsWith(monthWord.toLowerCase())),year=Number(match[3]);
    if(month<0||day<1||day>31)continue;
    const date=new Date(Date.UTC(year,month,day));
    if(date.getUTCMonth()===month&&date.getUTCDate()===day)return date.toISOString();
  }
  return null;
}
