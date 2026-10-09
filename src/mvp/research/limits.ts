/** Settings for "keep researching until enough buyers are saved". Shared by the engine, progress and extension rounds. */
const intEnv = (name: string, fallback: number, max: number) => {
  const raw = process.env[name]?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
/**
 * Saved buyers wanted before a search may stop early (0 turns extension off). By default the search's
 * own target (10-100); MVP_MIN_BUYERS overrides. Was a fixed 2, which stopped searches at 2 buyers.
 */
export const minimumBuyers = (target?: number) => intEnv('MVP_MIN_BUYERS', Math.max(2, Math.min(100, target ?? 10)), 100);
/** Extra rounds allowed after the first pass. */
export const maxExtensionRounds = () => intEnv('MVP_RESEARCH_EXTENSION_ROUNDS', 3, 5);
/** AI tokens always left for email reply analysis on the same day. */
export const emailAiReserve = () => intEnv('MVP_EMAIL_AI_RESERVE', 30_000, 150_000);
