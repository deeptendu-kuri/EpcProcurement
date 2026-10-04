// @vitest-environment node
/** Real orchestration/adapters + in-memory DB; ONLY external HTTP is mocked. No live sends. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, setDbForTests, type Db } from "@/mvp/db";
import { enrichOpportunity } from "@/mvp/enrichment";
import { getOpportunity, isVerified } from "@/mvp/opportunities";
import { encryptToken } from "./calendar";
import { setFunnelEnabled } from "./config";
import { controlThread, listThreadMessages, processFunnelTick, type FunnelThread } from "./engine";

let db: Db;
let evidenceId: string;
let inbox: Record<string, unknown>[];
let sent: Record<string, unknown>[];
let events: Record<string, unknown>[];
let decisions: unknown[];
let receivingFails: boolean;
const fetchMock = vi.fn();
const quote = "Unit EPC won the awarded pipeline construction contract; the scope includes procurement and installation of line pipe.";
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

beforeAll(async () => { db = await createTestDb(); setDbForTests(db); }, 120_000);
afterAll(async () => { setDbForTests(undefined); await db?.close(); });
beforeEach(async () => {
  for (const [key, value] of Object.entries({ DEMO_EMAIL_ENABLED: "1", DEMO_RECIPIENT_EMAIL: "deeptendukuri@gmail.com",
    DEMO_EMAIL_FROM: "Demo <onboarding@resend.dev>", RESEND_API_KEY: "integration-private", RESEND_RECEIVING_DOMAIN: "demo123.resend.app",
    GROQ_API_KEY: "integration-private", HUNTER_API_KEY: "integration-private", GOOGLE_CLIENT_ID: "test-client", GOOGLE_CLIENT_SECRET: "test-secret",
    SESSION_SECRET: "integration-session-secret-".repeat(3), APP_URL: "http://localhost:3007", SALES_TIMEZONE: "Asia/Kolkata",
    SALES_START_HOUR: "10", SALES_END_HOUR: "18", MEETING_DURATION_MINUTES: "30" })) vi.stubEnv(key, value);
  await db.exec("delete from funnel_messages;delete from funnel_threads;delete from funnel_integrations;delete from enrichment_requests;delete from contact_verification_requests;delete from search_opportunities;delete from leads;delete from projects;delete from runs;delete from contact_points;delete from person_roles;delete from people;delete from companies;delete from evidence;delete from llm_usage;update funnel_control set enabled=false,enabled_at=null,worker_until=null,worker_lease=null,last_error=null;");
  inbox = []; sent = []; events = []; decisions = []; receivingFails = false; fetchMock.mockReset();
  fetchMock.mockImplementation(async (input: string | URL, options: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.origin === "https://api.groq.com") {
      expect(decisions.length).toBeGreaterThan(0);
      return response({ choices: [{ message: { content: JSON.stringify(decisions.shift()) } }], usage: { prompt_tokens: 100, completion_tokens: 80 } });
    }
    if (url.origin === "https://api.hunter.io") {
      expect((options.headers as Record<string, string>)["X-API-KEY"]).toBe("integration-private");
      if (url.pathname.endsWith("domain-search")) return response({ data: { domain: "buyer.co", emails: [
        { value: "jane@buyer.co", type: "personal", first_name: "Jane", last_name: "Doe", position: "Procurement Manager", sources: [{ uri: "https://buyer.co/team" }] },
      ] } });
      if (url.pathname.endsWith("email-verifier")) return response({ data: { email: "jane@buyer.co", status: "valid", regexp: true,
        gibberish: false, disposable: false, webmail: false, mx_records: true, smtp_server: true, smtp_check: true, accept_all: false, block: false } });
    }
    if (url.origin === "https://api.resend.com") {
      if (url.pathname === "/emails/receiving") return receivingFails ? response({}, 401) : response({ data: inbox, has_more: false });
      if (url.pathname.startsWith("/emails/receiving/")) return response(inbox.find(item => item.id === url.pathname.split("/").at(-1)));
      if (url.pathname === "/emails" && options.method === "POST") {
        const body = JSON.parse(String(options.body)); sent.push(body);
        expect(body.to).toEqual(["deeptendukuri@gmail.com"]); expect(body.cc).toBeUndefined(); expect(body.bcc).toBeUndefined();
        expect((options.headers as Record<string, string>)["Idempotency-Key"]).toMatch(/^funnel-/);
        return response({ id: crypto.randomUUID() });
      }
    }
    if (url.origin === "https://oauth2.googleapis.com") return response({ access_token: "test-access" });
    if (url.origin === "https://api.emailable.com" && url.pathname === "/v1/verify") {
      expect((options.headers as Record<string,string>).authorization).toBe("Bearer live_integration_private");
      return response({email:url.searchParams.get("email"),state:"deliverable",accept_all:false,disposable:false,role:false,no_reply:false,mailbox_full:false,mx_record:"mx.buyer.co"});
    }
    if (url.origin === "https://www.googleapis.com") {
      if (url.pathname.endsWith("/freeBusy")) return response({ calendars: { "deeptendukuri@gmail.com": { busy: [] } } });
      if (url.pathname.includes("/events/") && !options.method) return response({}, 404);
      if (url.pathname.endsWith("/events") && options.method === "POST") {
        const body = JSON.parse(String(options.body)); events.push(body);
        expect(body.attendees).toEqual([{ email: "deeptendukuri@gmail.com" }]);
        return response({ id: body.id, conferenceData: { entryPoints: [{ entryPointType: "video", uri: "https://meet.google.com/abc-defg-hij" }] } });
      }
    }
    throw new Error(`Unexpected external request in isolated test: ${url.origin}${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function seedCompletedSearch() {
  await setFunnelEnabled(true);
  const company = (await db.query<{ id: string }>("insert into companies(canonical_name,normalized_name,country,types) values('Unit EPC','unit epc','IN','{main_epc}') returning id")).rows[0].id;
  const project = (await db.query<{ id: string }>("insert into projects(name,normalized_name,country,current_stage) values('Test pipeline','test pipeline','IN','awarded') returning id")).rows[0].id;
  const lead = (await db.query<{ id: string }>("insert into leads(kind,buyer_company_id,project_id,score_breakdown,gate_results,class,reasons,scoring_version,is_sample) values('supply_subcontract',$1,$2,'{}','[]','research','[]',1,false) returning id", [company, project])).rows[0].id;
  const run = (await db.query<{ id: string }>("insert into runs(status) values('done') returning id")).rows[0].id;
  evidenceId = (await db.query<{ id: string }>("insert into evidence(url,quote,quote_verified,extracted_by,tier,publisher_key) values('https://buyer.co/award',$1,true,'integration-test','A','buyer.co') returning id", [quote])).rows[0].id;
  const opportunity = (await db.query<{ id: string }>("insert into search_opportunities(run_id,lead_id,company_id,keyword,product_id,product_name,buying_reason,evidence_ids) values($1,$2,$3,'line pipe','line-pipe','Line pipe',$4,$5::uuid[]) returning id", [run, lead, company, quote, [evidenceId]])).rows[0].id;
  decisions.push({ approved: true, confidence: 0.96, reason: "Awarded pipeline scope includes line pipe", companyEvidenceId: evidenceId,
    companyQuote: quote, productEvidenceId: evidenceId, productQuote: quote });
  return opportunity;
}
async function thread(opportunity: string) {
  return (await db.query<FunnelThread>("select * from funnel_threads where opportunity_id=$1", [opportunity])).rows[0];
}
async function readyContact(opportunity: string) {
  const contact = (await enrichOpportunity(opportunity, { action: "search", domain: "buyer.co", domainConfirmed: true })).view.contacts[0];
  await enrichOpportunity(opportunity, { action: "confirm_role", personId: contact.id });
  await controlThread((await thread(opportunity)).id, "retry");
}
async function incoming(opportunity: string, text: string) {
  const t = await thread(opportunity);
  const email = { id: crypto.randomUUID(), from: "Deeptendu Kuri <deeptendukuri@gmail.com>", to: [`lead-${t.reply_token}@demo123.resend.app`],
    subject: "Re: Line pipe", text, created_at: new Date(Date.now() + (inbox.length + 1) * 1000).toISOString(), headers: {},
    authentication: { dmarc: "pass", dkim: "pass", spf: "pass" }, message_id: `<${crypto.randomUUID()}@mail.gmail.com>` };
  inbox.push(email); return email;
}

describe("joined local funnel with real adapters and mocked provider HTTP", () => {
  it("automatically sends a seller email using Emailable once a searched buyer's published current contact is reviewed",async()=>{
    vi.stubEnv("HUNTER_API_KEY","");vi.stubEnv("EMAILABLE_API_KEY","live_integration_private");
    const o=await seedCompletedSearch();await processFunnelTick();expect((await thread(o)).state).toBe("needs_contact");
    const opportunity=(await getOpportunity(o))!;
    const company=(await db.query<{company_id:string}>("select company_id from search_opportunities where id=$1",[o])).rows[0].company_id;
    await db.query("update companies set domain='buyer.co',domain_confirmed_at=now() where id=$1",[company]);
    const person=(await db.query<{id:string}>("insert into people(full_name,normalized_name,title,current_company_id,source) values('Jane Doe','jane doe','Procurement Manager',$1,'public-web') returning id",[company])).rows[0].id;
    await db.query("insert into contact_points(person_id,kind,value,source,validation_status) values($1,'email','jane@buyer.co','public-web:discovery','not_checked')",[person]);
    await db.query("update funnel_threads set next_action_at='2099-01-01T00:00:00Z' where opportunity_id=$1",[o]);
    await enrichOpportunity(o,{action:"confirm_role",personId:person});
    expect(Date.parse((await thread(o)).next_action_at)).toBeLessThan(Date.now()+5000);
    await processFunnelTick();expect(sent).toHaveLength(1);expect(isVerified((await getOpportunity(opportunity.id))!)).toBe(true);
    expect(String(sent[0].text)).toContain("Congratulations on your recent contract award");expect(String(sent[0].text)).toContain("procurement options for Line pipe");
    expect((await db.query("select source,validation_status from contact_points where person_id=$1",[person])).rows[0]).toMatchObject({source:"provider:emailable:verifier",validation_status:"valid"});
    expect((await db.query("select id from contact_verification_requests")).rows).toHaveLength(1);
    await processFunnelTick();expect(sent).toHaveLength(1);
  });
  it("runs completed search → reviewed contact → Hunter validation → email → AI reply → Calendar meeting in one persistent conversation", async () => {
    const o = await seedCompletedSearch();
    await processFunnelTick();
    expect((await thread(o)).state).toBe("needs_contact"); expect(sent).toHaveLength(0);
    await readyContact(o); await processFunnelTick();
    expect(isVerified((await getOpportunity(o))!)).toBe(true); expect(sent).toHaveLength(1);
    expect(sent[0].reply_to).toMatch(/^lead-[a-f0-9]{48}@demo123\.resend\.app$/);
    expect(String(sent[0].text).toLowerCase()).toContain("line pipe"); expect((await thread(o)).state).toBe("active");
    expect(sent[0].text).toContain("Congratulations on your recent contract award.");
    expect(sent[0].text).toContain("I'm Deeptendu Kuri");expect(sent[0].text).toContain("quality expectations and budget");
    expect(sent[0].text).not.toContain("your line pipe offering");

    decisions.push({ intent: "question", confidence: 0.95, summary: "Asked about line pipe specifications", body: "Could you share the required grade and dimensions so we can discuss the line pipe requirements?" });
    const firstReply = await incoming(o, "What specifications do you need from me?"); await processFunnelTick();
    expect(sent).toHaveLength(2); expect(sent[1].headers).toMatchObject({ "In-Reply-To": firstReply.message_id });
    expect((await getOpportunity(o))!.summary).toContain("specifications");

    await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com',$1)", [encryptToken("test-refresh")]);
    decisions.push({ intent: "meeting_request", confidence: 0.98, summary: "Requested a line pipe meeting", body: "Happy to discuss." });
    await incoming(o, "Please set up a meeting and share the meeting link."); await processFunnelTick();
    const offered = await thread(o); expect(offered.state).toBe("awaiting_time"); expect(offered.offered_slots).toHaveLength(3);
    expect(events).toHaveLength(0); expect(sent[2].text).toContain("Slot 2:");

    decisions.push({ intent: "meeting_request", confidence: 0.99, summary: "Selected the second offered meeting slot", body: "Thank you." });
    await incoming(o, "Please book slot 2"); await processFunnelTick();
    expect((await thread(o)).state).toBe("meeting_pending"); await processFunnelTick();
    expect(events).toHaveLength(1); expect(events[0].start).toMatchObject({ dateTime: offered.offered_slots[1] });
    expect((await thread(o)).state).toBe("meeting_booked"); expect(sent).toHaveLength(4);
    expect(sent[3].text).toContain("https://meet.google.com/abc-defg-hij");
    expect((await getOpportunity(o))!.summary).toContain("Meeting:");
    expect((await listThreadMessages(o)).filter(m => m.direction === "in")).toHaveLength(3);
    await processFunnelTick(); expect(sent).toHaveLength(4); expect(events).toHaveLength(1);
    expect((await db.query("select id from llm_usage where provider='groq' and purpose='sales_funnel' and ok=true")).rows).toHaveLength(4);
  });

  it("blocks the joined flow when receiving permissions fail, and resumes safely after restoration", async () => {
    const o = await seedCompletedSearch(); await processFunnelTick(); await readyContact(o);
    receivingFails = true; await expect(processFunnelTick()).rejects.toThrow("HTTP 401");
    expect(sent).toHaveLength(0); expect((await thread(o)).state).toBe("needs_contact");
    receivingFails = false; await processFunnelTick(); expect(sent).toHaveLength(1);
    await processFunnelTick(); expect(sent).toHaveLength(1);
  });
});
