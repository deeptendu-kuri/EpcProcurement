/**
 * Shortlist scoring against the golden set (docs/mvp/19 Phase 0). The golden set is 184 companies our
 * real searches found (steel plates, steel pipe, welded stainless), labelled by hand with how they buy.
 * Pure: give it predictions, get precision, junk and buyer-type accuracy per search.
 */
export type GoldLabel = 'end_user' | 'contractor' | 'subcontractor' | 'owner' | 'reseller' | 'competitor' | 'not_buyer';
export interface GoldRow { set: string; product: string; name: string; said: string; page: string; label: GoldLabel; unsure?: boolean }
export interface Prediction { rating: number; buyerType?: string | null }
export interface SetScore {
  set: string; scored: number; buyers: number;
  /** Share of the 20 best-rated (or fewer) that are real buyers. */
  precisionTop20: number;
  /** Companies rated likely (≥ 45) and how many of them are not buyers. */
  likely: number; junkInLikely: number;
  /** Real buyers rated likely. */
  recall: number;
  /** Competitors rated likely (should be 0). */
  competitorsLikely: number;
  /** Where a buyer type is predicted: share that matches the label. */
  typeAccuracy: number | null;
}

export const LIKELY = 45;
export const goldKey = (r: Pick<GoldRow, 'set' | 'name'>) => `${r.set}|${r.name}`;
export function isBuyer(label: GoldLabel, resellers = true): boolean {
  return label === 'end_user' || label === 'contractor' || label === 'subcontractor' || label === 'owner' || (resellers && label === 'reseller');
}
const ratio = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 1000 : 0);

export function scoreShortlist(rows: GoldRow[], predictions: Map<string, Prediction>, options: { resellers?: boolean } = {}): { sets: SetScore[]; overall: SetScore } {
  const resellers = options.resellers ?? true;
  const sure = rows.filter((r) => !r.unsure && predictions.has(goldKey(r)));
  const score = (set: string, list: GoldRow[]): SetScore => {
    const ranked = [...list].sort((a, b) => predictions.get(goldKey(b))!.rating - predictions.get(goldKey(a))!.rating);
    const top = ranked.slice(0, Math.min(20, ranked.length));
    const likely = list.filter((r) => predictions.get(goldKey(r))!.rating >= LIKELY);
    const buyers = list.filter((r) => isBuyer(r.label, resellers));
    const typed = list.filter((r) => predictions.get(goldKey(r))!.buyerType);
    return {
      set, scored: list.length, buyers: buyers.length,
      precisionTop20: ratio(top.filter((r) => isBuyer(r.label, resellers)).length, top.length),
      likely: likely.length, junkInLikely: ratio(likely.filter((r) => !isBuyer(r.label, resellers)).length, likely.length),
      recall: ratio(buyers.filter((r) => predictions.get(goldKey(r))!.rating >= LIKELY).length, buyers.length),
      competitorsLikely: likely.filter((r) => r.label === 'competitor').length,
      typeAccuracy: typed.length ? ratio(typed.filter((r) => sameType(r.label, predictions.get(goldKey(r))!.buyerType!)).length, typed.length) : null,
    };
  };
  const sets = [...new Set(sure.map((r) => r.set))].map((set) => score(set, sure.filter((r) => r.set === set)));
  // Overall precision is the mean over searches, so one big search does not hide a weak one.
  const all = score('all', sure);
  all.precisionTop20 = ratio(sets.reduce((n, s) => n + s.precisionTop20, 0), sets.length);
  return { sets, overall: all };
}

/** Subcontractor and contractor count as the same family; everything else must match. */
function sameType(label: GoldLabel, predicted: string): boolean {
  if (label === predicted) return true;
  return (label === 'contractor' || label === 'subcontractor') && (predicted === 'contractor' || predicted === 'subcontractor');
}
