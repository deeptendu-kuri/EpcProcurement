import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getDb } from "@/mvp/db";
import { AUTOMATION_RECIPIENT, calendarPreferences } from "./config";
import { businessTime } from "./policy";

function encryptionKey() {
  const secret = process.env.SESSION_SECRET?.trim() ?? "";
  if (secret.length < 32) throw new Error("A 32-character SESSION_SECRET is required to protect calendar credentials.");
  return createHash("sha256").update(`calendar-token:${secret}`).digest();
}
export function encryptToken(text: string): string {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const body = Buffer.concat([cipher.update(text,"utf8"),cipher.final()]);
  return [iv,cipher.getAuthTag(),body].map(p=>p.toString("base64url")).join(".");
}
export function decryptToken(text: string): string {
  const [iv,tag,body] = text.split(".").map(p=>Buffer.from(p,"base64url"));
  const cipher = createDecipheriv("aes-256-gcm",encryptionKey(),iv); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(body),cipher.final()]).toString("utf8");
}
function oauthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim(); const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const appUrl = process.env.APP_URL?.trim();
  if (!clientId || !clientSecret || !appUrl) throw new Error("Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and APP_URL for Calendar OAuth.");
  const url = new URL(appUrl);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost","127.0.0.1"].includes(url.hostname))) throw new Error("OAuth requires HTTPS or a local localhost URL.");
  return { clientId,clientSecret,redirectUri: `${url.origin}/api/mvp/automation/calendar/callback` };
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export async function beginCalendarConnection() {
  const c = oauthConfig(); const state = randomBytes(32).toString("base64url");
  await getDb().query("delete from funnel_oauth_states where expires_at <= now()");
  await getDb().query("insert into funnel_oauth_states (digest,expires_at) values ($1,now()+interval '10 minutes')",[digest(state)]);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id:c.clientId,redirect_uri:c.redirectUri,response_type:"code",access_type:"offline",prompt:"consent",
    scope:"https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.calendarlist.readonly",
    state,login_hint:AUTOMATION_RECIPIENT }).toString();
  return { url:url.toString(),state };
}
async function exchange(params: Record<string,string>): Promise<{ access_token: string; refresh_token?: string }> {
  const c = oauthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", { method:"POST",redirect:"error",
    headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({ ...params,client_id:c.clientId,client_secret:c.clientSecret }),signal:AbortSignal.timeout(20_000) });
  const data = await res.json().catch(()=>null);
  if (!res.ok || typeof data?.access_token !== "string") throw new Error(`Google authorization failed (HTTP ${res.status}). Reconnect Calendar; tokens were not logged.`);
  return data;
}
async function google(path: string, token: string, options: RequestInit = {}): Promise<Record<string, unknown>> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`,{ ...options,redirect:"error",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},signal:AbortSignal.timeout(20_000) });
  const data = await res.json().catch(()=>null);
  if (!res.ok) throw new Error(`Google Calendar request failed (HTTP ${res.status}). Check connection and permissions.`);
  return data;
}
export async function finishCalendarConnection(code: string, state: string, cookie: string | undefined) {
  if (!cookie || cookie !== state || state.length < 32) throw new Error("Calendar connection state does not match this browser. Start again.");
  const used = await getDb().query("delete from funnel_oauth_states where digest=$1 and expires_at>now() returning digest",[digest(state)]);
  if (!used.rows.length) throw new Error("Calendar connection expired or was already used.");
  const token = await exchange({code,grant_type:"authorization_code",redirect_uri:oauthConfig().redirectUri});
  const calendar = await google("users/me/calendarList/primary",token.access_token);
  if (calendar.id !== AUTOMATION_RECIPIENT || calendar.accessRole !== "owner") throw new Error(`Connect only ${AUTOMATION_RECIPIENT}'s own calendar for this demo.`);
  if (!token.refresh_token) throw new Error("Google did not supply offline access. Reconnect using the consent screen.");
  await getDb().query(`insert into funnel_integrations (provider,account,encrypted_refresh_token) values ('google',$1,$2)
    on conflict (provider) do update set account=excluded.account,encrypted_refresh_token=excluded.encrypted_refresh_token,connected_at=now()`,[AUTOMATION_RECIPIENT,encryptToken(token.refresh_token)]);
}
async function accessToken() {
  const row = (await getDb().query<{ account:string;encrypted_refresh_token:string }>("select account,encrypted_refresh_token from funnel_integrations where provider='google'")).rows[0];
  if (!row || row.account !== AUTOMATION_RECIPIENT) throw new Error("Connect your Google Calendar in Outreach before scheduling.");
  return (await exchange({grant_type:"refresh_token",refresh_token:decryptToken(row.encrypted_refresh_token)})).access_token;
}
type Busy = { start: string;end: string };
async function busy(token: string,start: string,end: string): Promise<Busy[]> {
  const result = await google("freeBusy",token,{method:"POST",body:JSON.stringify({timeMin:start,timeMax:end,items:[{id:AUTOMATION_RECIPIENT}]})});
  const cal = (result.calendars as Record<string,{busy:Busy[];errors?:unknown[]}>)?.[AUTOMATION_RECIPIENT];
  if (!cal || cal.errors?.length || !Array.isArray(cal.busy)) throw new Error("Calendar availability could not be verified. No meeting booked.");
  return cal.busy;
}
export function chooseSlots(now: Date, occupied: Busy[]): string[] {
  const p = calendarPreferences(); const slots: string[]=[]; const dates=new Set<string>();
  const start = Math.ceil((now.getTime()+60*60_000)/(15*60_000))*15*60_000;
  for (let time=start;time<now.getTime()+7*24*60*60_000 && slots.length<3;time+=15*60_000) {
    const date=new Date(time); const end=new Date(time+p.duration*60_000-1);
    const day = new Intl.DateTimeFormat("en-CA",{timeZone:p.timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
    if (dates.has(day) || !businessTime(date,p.timeZone,p.startHour,p.endHour) || !businessTime(end,p.timeZone,p.startHour,p.endHour)) continue;
    if (occupied.some(b=>Date.parse(b.start)<end.getTime()+1 && Date.parse(b.end)>time)) continue;
    slots.push(date.toISOString()); dates.add(day);
  }
  return slots;
}
export async function availableSlots(now = new Date()): Promise<string[]> {
  const token = await accessToken();
  return chooseSlots(now,await busy(token,now.toISOString(),new Date(now.getTime()+7*24*60*60_000).toISOString()));
}
export function eventId(threadId: string) { return `epc${createHash("sha256").update(threadId).digest("hex").slice(0,40)}`; }
function meetLink(data: Record<string,unknown>): string | null {
  const conference = data.conferenceData as {entryPoints?: {entryPointType:string;uri:string}[]; createRequest?: {status?:{statusCode?:string}} } | undefined;
  const link = conference?.entryPoints?.find(p=>p.entryPointType==="video")?.uri;
  return typeof link === "string" && /^https:\/\/meet\.google\.com\/[a-z-]+$/.test(link) ? link : null;
}
export async function bookDemoMeeting(threadId: string,start: string,product: string): Promise<{id:string;url:string|null}> {
  const token=await accessToken(); const id=eventId(threadId); const p=calendarPreferences();
  const end=new Date(Date.parse(start)+p.duration*60_000).toISOString();
  // Deterministic event ID recovers a successful insert followed by an interrupted DB update.
  const lookup=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${id}`,{redirect:"error",headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
  if (lookup.ok) {
    const existing=await lookup.json();
    if (existing.status === "cancelled" || existing.start?.dateTime !== start && Date.parse(existing.start?.dateTime) !== Date.parse(start)) throw new Error("Existing meeting changed or was cancelled; review it.");
    return {id,url:meetLink(existing)};
  }
  if (lookup.status!==404) throw new Error("Could not verify whether this meeting already exists.");
  if (Date.parse(start)<=Date.now() || !businessTime(new Date(start),p.timeZone,p.startHour,p.endHour)
    || !businessTime(new Date(Date.parse(end)-1),p.timeZone,p.startHour,p.endHour)) throw new Error("Meeting slot expired or is outside working hours.");
  if ((await busy(token,start,end)).length) throw new Error("That slot is no longer free. Ask the buyer to select another time.");
  const data=await google("calendars/primary/events?conferenceDataVersion=1&sendUpdates=all",token,{method:"POST",body:JSON.stringify({
    id,summary:`[Demo] ${product} discussion — Deeptendu Kuri`,description:"EPC procurement MVP demo. No real buyer was invited.",
    start:{dateTime:start,timeZone:p.timeZone},end:{dateTime:end,timeZone:p.timeZone},attendees:[{email:AUTOMATION_RECIPIENT}],
    conferenceData:{createRequest:{requestId:id,conferenceSolutionKey:{type:"hangoutsMeet"}}},
  })});
  if (data.id!==id) throw new Error("Calendar did not return the expected event ID.");
  return {id,url:meetLink(data)};
}
