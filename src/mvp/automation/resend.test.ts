// @vitest-environment node
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {approvedIncoming,replyAddress,sendFunnelMessage,listInboxPage} from "./resend";
const fetchMock=vi.fn();
beforeEach(()=>{
  vi.stubEnv("DEMO_EMAIL_ENABLED","1");vi.stubEnv("DEMO_RECIPIENT_EMAIL","deeptendukuri@gmail.com");
  vi.stubEnv("RESEND_API_KEY","test-key-not-real");vi.stubEnv("RESEND_RECEIVING_DOMAIN","demo123.resend.app");
  vi.stubEnv("GROQ_API_KEY","unit");vi.stubEnv("HUNTER_API_KEY","unit");vi.stubEnv("DEMO_EMAIL_FROM","Demo <onboarding@resend.dev>");
  fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("threaded Gmail-only delivery",()=>{
  it("locks recipient, freezes the provider key and includes unique Reply-To and RFC threading",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify({id:"provider-resource-id"}),{status:200}));
    const message={id:"test-message",subject:"Re: [Demo] Line pipe",body:"Thank you",reply_to:replyAddress("a".repeat(48)),in_reply_to:"<gmail-id@mail.gmail.com>"};
    expect(await sendFunnelMessage(message)).toEqual({id:"provider-resource-id",rfcId:null});
    const call=fetchMock.mock.calls[0][1];const body=JSON.parse(call.body);
    expect(body.to).toEqual(["deeptendukuri@gmail.com"]);expect(body.cc).toBeUndefined();expect(body.bcc).toBeUndefined();
    expect(body.reply_to).toBe("lead-"+"a".repeat(48)+"@demo123.resend.app");
    expect(body.headers["In-Reply-To"]).toBe(message.in_reply_to);expect(call.headers["Idempotency-Key"]).toBe("funnel-test-message");
  });
  it("rejects a changed recipient or receiving domain before HTTP",async()=>{
    const m={id:"x",subject:"Hi",body:"Hi",reply_to:replyAddress("b".repeat(48)),in_reply_to:null};
    vi.stubEnv("DEMO_RECIPIENT_EMAIL","buyer@example.com");await expect(sendFunnelMessage(m)).rejects.toThrow("locked");
    vi.stubEnv("DEMO_RECIPIENT_EMAIL","deeptendukuri@gmail.com");vi.stubEnv("RESEND_RECEIVING_DOMAIN","new123.resend.app");
    await expect(sendFunnelMessage(m)).rejects.toThrow("changed");expect(fetchMock).not.toHaveBeenCalled();
  });
  it("accepts only the approved Gmail with provider-reported DMARC authentication",()=>{
    const incoming={id:crypto.randomUUID(),from:"Deeptendu <deeptendukuri@gmail.com>",to:[replyAddress("a".repeat(48))],subject:"Hi",created_at:new Date().toISOString(),authentication:{dmarc:"pass",dkim:"pass",spf:"pass"}};
    expect(approvedIncoming(incoming)).toBe(true);
    expect(approvedIncoming({...incoming,authentication:null})).toBe(false);
    expect(approvedIncoming({...incoming,from:"someone@gmail.com"})).toBe(false);
    expect(approvedIncoming({...incoming,authentication:{...incoming.authentication,dmarc:"fail"}})).toBe(false);
  });
  it("uses the receiving API with pagination and reports permissions without leaking keys",async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({data:[],has_more:false}),{status:200}));
    expect(await listInboxPage()).toEqual({data:[],has_more:false});
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.resend.com/emails/receiving?limit=100");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({message:"secret error payload"}),{status:401}));
    await expect(listInboxPage()).rejects.toThrow("HTTP 401");
  });
});
