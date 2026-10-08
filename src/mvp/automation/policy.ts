import { z } from "zod";

export const MAX_FOLLOWUPS = 2;
export const FOLLOWUP_DELAY_MS = 3 * 24 * 60 * 60 * 1000;
export const replySchema = z.object({
  intent: z.enum(["positive","question","meeting_request","rejected","opt_out","auto_reply","unknown"]),
  confidence: z.number().min(0).max(1), summary: z.string().min(1).max(2000), body: z.string().max(4000),
}).strict();
export type ReplyDecision = z.infer<typeof replySchema>;
/** Gmail wraps attribution headers across lines, including inside <addresses>.
 * Never treat the quoted sent timestamp as the buyer's proposed meeting time. */
function replyAttribution(lines:string[],start:number):boolean {
  if(!/^[ \t]*On\s+/i.test(lines[start]))return false;
  let header='';
  for(let i=start;i<Math.min(lines.length,start+6);i++){
    const line=lines[i];
    if(i>start&&(!line.trim()||/^[ \t]*>/.test(line)))return false;
    header+=(header?' ':'')+line.trim();
    if(header.length>1200)return false;
    if(/\bwrote:[ \t]*$/i.test(header))return true;
  }
  return false;
}
export function freshReply(text: string): string {
  const lines=text.replace(/\r\n?/g,'\n').split('\n');
  const boundary=lines.findIndex((line,index)=>replyAttribution(lines,index)
    || index>0&&/^[ \t]*(?:_{5,}|-{2,}\s*Original Message\s*-{2,}|From:\s)/i.test(line));
  return (boundary<0?lines:lines.slice(0,boundary))
    .filter(line => !/^\s*>/.test(line)).join("\n").trim().slice(0, 8000);
}
/** Mandatory deterministic stops precede any AI call. Never let a model override opt-out. */
export function hardStop(text: string, headers: Record<string,string> = {}): "opt_out" | "rejected" | "auto_reply" | null {
  const body = freshReply(text);
  if (/\b(unsubscribe|remove me|stop (?:emailing|contacting|sending|messaging)|do not contact|don'?t contact|opt[ -]?out)\b/i.test(body)) return "opt_out";
  if (/\b(not interested|no thank(?:s| you)|please don'?t follow up)\b/i.test(body)) return "rejected";
  const h = Object.fromEntries(Object.entries(headers).map(([k,v]) => [k.toLowerCase(),v.toLowerCase()]));
  if ((h["auto-submitted"] && h["auto-submitted"] !== "no") || /bulk|list|junk/.test(h.precedence ?? "")
    || /\b(out of (?:the )?office|automatic reply|auto(?:matic)?[ -]response)\b/i.test(body)) return "auto_reply";
  return null;
}
/** Only an explicit selection of a previously offered slot authorizes a booking. */
export function selectedSlot(text: string, slots: string[]): string | null {
  const body = freshReply(text);
  if (/\b(not|no|can't|cannot|unavailable|reschedule|maybe|tentative|unsure|or)\b/i.test(body)) return null;
  const choices = [...body.matchAll(/\b(?:slot|option)\s*([1-3])\b/gi)];
  const unique = [...new Set(choices.map(m => Number(m[1]) - 1))];
  const bareChoice=/^(?:slot|option)\s*[1-3][.!]?$/i.test(body);
  if (unique.length !== 1 || !bareChoice && !/\b(confirm|book|yes|works|fine|agree|choose|please|schedule|available)\b/i.test(body)) return null;
  return slots[unique[0]] ?? null;
}
export function messageIdSafe(value: unknown): string | null {
  return typeof value === "string" && /^<[^<>\s\r\n]{1,250}>$/.test(value) ? value : null;
}
export function businessTime(now: Date, timeZone: string, startHour: number, endHour: number): boolean {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, weekday:"short", hour:"2-digit", hourCycle:"h23" }).formatToParts(now).map(p=>[p.type,p.value]));
  return !["Sat","Sun"].includes(parts.weekday) && Number(parts.hour)>=startHour && Number(parts.hour)<endHour;
}
