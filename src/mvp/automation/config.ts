import { getDb } from "@/mvp/db";
import { automationSettings, AUTOMATION_RECIPIENT } from "@/mvp/email/campaigns";
import { hunterConfigured } from "@/mvp/enrichment/hunter";
import { emailableConfigured } from "@/mvp/enrichment/emailable";

export { AUTOMATION_RECIPIENT };
const identityText = (value: string | undefined, limit: number) => value?.replace(/[\r\n<>]/g," ").trim().slice(0,limit) || null;
export const seller = () => ({ name: identityText(process.env.SALES_PERSON_NAME,120) || "Deeptendu Kuri", email: AUTOMATION_RECIPIENT,
  company: identityText(process.env.SALES_COMPANY_NAME,160),
  description: "EPC procurement support for the exact searched product. Evaluate sourcing options against the buyer's technical requirements, quality expectations and budget. Certifications, stock, prices and lead times are not confirmed." });
export function sellerSignature() { const s=seller();return `Kind regards,\n${s.name}${s.company?`\n${s.company}`:""}\nProcurement support\n${s.email}`; }
export async function calendarConnected() {
  return Boolean((await getDb().query("select account from funnel_integrations where provider='google' and account=$1",[AUTOMATION_RECIPIENT])).rows.length);
}
export function receivingDomain(): string {
  const value = process.env.RESEND_RECEIVING_DOMAIN?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.resend\.app$/.test(value))
    throw new Error("Set RESEND_RECEIVING_DOMAIN to your public <id>.resend.app receiving domain (not an API key or email address).");
  return value;
}
export function requireFunnelConfig() {
  const settings = automationSettings();
  receivingDomain();
  if (!process.env.GROQ_API_KEY?.trim()) throw new Error("Groq is required for live qualification and replies; simulated AI never sends automatically.");
  if (!hunterConfigured() && !emailableConfigured()) throw new Error("Connect Emailable or Hunter before enabling the live buyer/contact funnel.");
  return settings;
}
export function calendarPreferences() {
  const timeZone = process.env.SALES_TIMEZONE?.trim() || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { throw new Error("Invalid SALES_TIMEZONE."); }
  const duration = Number(process.env.MEETING_DURATION_MINUTES || "30");
  const startHour = Number(process.env.SALES_START_HOUR || "10");
  const endHour = Number(process.env.SALES_END_HOUR || "18");
  if (![15,30,45,60].includes(duration) || !Number.isInteger(startHour) || !Number.isInteger(endHour) || startHour < 0 || endHour > 24 || startHour >= endHour)
    throw new Error("Check meeting duration and sales working hours.");
  return { timeZone, duration, startHour, endHour, account: AUTOMATION_RECIPIENT };
}
export async function funnelStatus() {
  const control = (await getDb().query<{ enabled: boolean; enabled_at: string | null; last_tick_at: string | null; last_error: string | null }>(
    "select enabled, enabled_at, last_tick_at, last_error from funnel_control where id=1")).rows[0];
  const calendar = (await getDb().query<{ account: string }>("select account from funnel_integrations where provider='google'")).rows[0];
  let configError: string | null = null;
  try { requireFunnelConfig(); } catch (error) { configError = error instanceof Error ? error.message : "Configuration incomplete."; }
  return { ...control, ready: !configError, configError, recipient: AUTOMATION_RECIPIENT, seller: seller(),
    groq: Boolean(process.env.GROQ_API_KEY?.trim()), hunter: hunterConfigured(), emailable:emailableConfigured(),
    tavily: Boolean(process.env.TAVILY_API_KEY?.trim()), receiving: (() => { try { return receivingDomain(); } catch { return null; } })(),
    calendar: calendar?.account ?? null, calendarSetup: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    worker: process.env.MVP_FUNNEL_WORKER === "on", preferences: calendarPreferences() };
}
export async function setFunnelEnabled(enabled: boolean) {
  if (enabled) {
    requireFunnelConfig();
    if ((await getDb().query("select recipient from funnel_suppressions where recipient=$1",[AUTOMATION_RECIPIENT])).rows.length)
      throw new Error("This demo recipient opted out and remains suppressed. Enabling automation cannot undo an opt-out.");
  }
  await getDb().query(`update funnel_control set enabled=$1, enabled_at=case when $1::boolean then coalesce(enabled_at,now()) else enabled_at end,
    last_error=null where id=1`, [enabled]);
  return funnelStatus();
}
