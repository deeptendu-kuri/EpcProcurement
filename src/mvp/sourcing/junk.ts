import domains from './junk-domains.json';
const TITLE=/market\s+(?:size|report|analysis|outlook)|cagr|salary|jobs?\b|career/i;
const matches=(host:string,domain:string)=>host===domain||host.endsWith(`.${domain}`);
/** Called before any page fetch, including investigation follow-ups and redirects. */
export function junkReason(url:string,title:string|null,markets:readonly string[]=[]):string|null {
  let parsed:URL;try{parsed=new URL(url);}catch{return 'invalid URL';}
  if(!/^https?:$/.test(parsed.protocol))return 'unsupported URL';
  const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
  if(/(?:^|\.)(?:amazon|glassdoor|indeed|naukri)\.[a-z.]+$/.test(host))return 'excluded source';
  if(domains.blocked.some(d=>matches(host,d)))return /ibisworld|mordor|spherical/.test(host)?'market report':'excluded source';
  if(domains.usOnly.some(d=>matches(host,d))&&!markets.includes('US'))return 'outside source coverage';
  if(TITLE.test(title??''))return 'market report / jobs';
  // No Google/Bing/Yahoo result HTML, even when a collector returns a redirect.
  if(/(?:^|\.)(?:google\.[a-z.]+|bing\.com|search\.yahoo\.com)$/.test(host)&&/\/(?:search|news\/search)/.test(parsed.pathname))return 'search-result page';
  return null;
}
