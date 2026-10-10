/** Company name matching, with no other imports so any module can use it (found.ts, opportunities). */
// "GASCO, Abu Dhabi" and "GASCO" are one company: the place after a comma is not part of the name.
// "(KPIL)" is a short form, not part of the name, so "… Ltd (KPIL)" and "… Limited" match.
/** Initials of the name's words ("Saline Water Conversion Corporation" → "swcc"). */
export const initialsOf = (name: string) => (name.replace(/\([^)]*\)/g, ' ').match(/[A-Za-z][A-Za-z'&]*/g) ?? []).map((w) => w[0].toLowerCase()).join('');
// Words a short name often drops: "ACWA" for "ACWA Power", "Tekzone" for "Tekzone Industrial Construction".
const NAME_TAIL = /^(?:power|group|energy|holdings?|international|global|engineering|construction|contracting|industrial|industries|services|technologies|me|middleeast|ksa|uae|arabia|saudi)+$/;
/** The same company written two ways: equal keys, a short name plus a generic tail, or initials. */
export function sameCompany(a: { key: string; initials: string }, b: { key: string; initials: string }): boolean {
  if (a.key === b.key) return true;
  const [short, long] = a.key.length <= b.key.length ? [a, b] : [b, a];
  if (short.key.length >= 4 && long.key.startsWith(short.key) && NAME_TAIL.test(long.key.slice(short.key.length))) return true;
  return short.key.length >= 3 && short.key.length <= 6 && short.key === long.initials;
}
export const companyKey = (name: string) => name.split(',')[0].replace(/\([^)]*\)/g, ' ').toLowerCase()
  // Roman numerals as numbers: "SEPCO-III" = "Sepco3".
  .replace(/\biii\b/g, '3').replace(/\bii\b/g, '2')
  // Legal forms, including European and Gulf ones ("Tecnimont S.p.A.", "Saipem SA", "Target Engineering W.L.L.").
  .replace(/\bs\.?p\.?a\b\.?|\bs\.a\.(?=\s|$)|\bw\.?l\.?l\b\.?|\bb\.v\b\.?|\bn\.v\b\.?/g, '')
  .replace(/\b(?:ltd|limited|llc|l\.l\.c|pvt|private|inc|plc|co|company|corporation|corp|sa|ag|gmbh|bv|nv|srl|sarl|pjsc|psc|wll|fze|fzco|fzc|est)\b\.?/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
/** Two names for one company ("Tecnimont" and "Tecnimont S.p.A.", "SWCC" and "Saline Water Conversion Corporation"). */
export const sameCompanyName = (a: string, b: string) => sameCompany({ key: companyKey(a), initials: initialsOf(a) }, { key: companyKey(b), initials: initialsOf(b) });
