/** Settings for "keep researching until enough buyers are saved". Shared by the engine, progress and extension rounds. */
const intEnv = (name: string, fallback: number, max: number) => {
  const raw = process.env[name]?.trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
};
/** Saved buyers wanted before a search may stop early (0 turns extension off). */
export const minimumBuyers = () => intEnv('MVP_MIN_BUYERS', 2, 10);
/** Extra rounds allowed after the first pass. */
export const maxExtensionRounds = () => intEnv('MVP_RESEARCH_EXTENSION_ROUNDS', 3, 5);
/** AI tokens always left for email reply analysis on the same day. */
export const emailAiReserve = () => intEnv('MVP_EMAIL_AI_RESERVE', 30_000, 150_000);
