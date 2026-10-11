/** A contract award is not a prize. Selection to perform physical EPC work
 * with an actual contract/NTP also establishes a won construction package. */
export function wonConstructionContract(text:string):boolean {
  if(!/\b(?:contracts?|orders?|EPC|EPCC|package|notice to proceed|NTP)\b/i.test(text))return false;
  if(/\b(?:awarded|wins?|won|secured|signed.{0,30}contract)\b/i.test(text))return true;
  return /\bselected to (?:deliver|execute|perform|build)\b/i.test(text)
    && /\b(?:procurement|fabrication|construction|install\w*)\b/i.test(text)
    && /\b(?:contract|notice to proceed|NTP)\b/i.test(text);
}
