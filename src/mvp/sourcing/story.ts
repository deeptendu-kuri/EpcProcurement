/**
 * Several outlets often report the same contract ("KPIL bags ₹4,000 crore UAE pipeline order").
 * Reading each copy with AI spends the whole budget on one buyer. A likely repeat is not skipped,
 * only analysed after list articles and company pages, so nothing is lost if the guess is wrong.
 */
const GENERIC = new Set(`a an the and or of for in on at to by with from as its it is are be has have was were will this that
wins win won winning bags bagged secures secured secure gets got lands landed receives received bag announces announced award awarded awards
contract contracts order orders project projects deal work works package worth value valued over plus more than about major mega large big new
epc engineering procurement construction pipeline pipelines pipe pipes line gas oil water cable cables power transmission onshore offshore
crore crores lakh rs inr usd aed sar million billion mn bn cr stock shares share slips rises jumps falls surges gains news update
international limited ltd company co corp group projects india indian uae saudi arabia qatar oman kuwait bahrain norway malaysia emirates
gulf middle east global first second third phase from via report reports says said today monday tuesday wednesday thursday friday saturday sunday`
  .split(/\s+/));

/** Distinctive words of a headline: company names, amounts and places beyond the common set. */
export function storyTokens(title: string | null | undefined): Set<string> {
  const words = (title ?? '').toLowerCase().normalize('NFKD').replace(/[,₹$€]/g, '').match(/[a-z0-9]+/g) ?? [];
  return new Set(words.filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !GENERIC.has(w)));
}

/**
 * True when two headlines most likely report the same event: every name word of the shorter
 * headline appears in the other, and any amounts they both state agree.
 */
export function sameStory(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = storyTokens(a), y = storyTokens(b);
  const [small, big] = x.size <= y.size ? [x, y] : [y, x];
  const names = [...small].filter((w) => !/^\d+$/.test(w));
  if (!names.length || !names.every((w) => big.has(w))) return false;
  const nx = [...x].filter((w) => /^\d+$/.test(w)), ny = [...y].filter((w) => /^\d+$/.test(w));
  return !(nx.length && ny.length && !nx.some((n) => ny.includes(n)));
}

/** Priority for an article that repeats a story already queued: after roundups (950) and company pages (600). */
export const REPEAT_STORY_PRIORITY = 450;
