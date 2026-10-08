// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,it,expect,vi} from "vitest";
import {createTestDb,setDbForTests,type Db} from "@/mvp/db";
import {beginCalendarConnection,finishCalendarConnection,bookDemoMeeting,encryptToken,eventId,calendarReturnPath} from "./calendar";
const fetchMock=vi.fn();let db:Db;
beforeAll(async()=>{db=await createTestDb();setDbForTests(db);},120_000);
afterAll(async()=>{setDbForTests(undefined);await db?.close();});
beforeEach(async()=>{
  vi.setSystemTime(new Date("2026-10-04T08:00:00Z"));
  vi.stubEnv("SESSION_SECRET","test-session-secret-".repeat(3));vi.stubEnv("GOOGLE_CLIENT_ID","unit-client");vi.stubEnv("GOOGLE_CLIENT_SECRET","unit-secret");vi.stubEnv("APP_URL","http://localhost:3007");
  vi.stubEnv("SALES_TIMEZONE","Asia/Kolkata");vi.stubEnv("MEETING_DURATION_MINUTES","30");
  fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);await db.exec("delete from funnel_integrations;delete from funnel_oauth_states;");
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.useRealTimers();});
const response=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
async function connected(){await db.query("insert into funnel_integrations(provider,account,encrypted_refresh_token) values('google','deeptendukuri@gmail.com',$1)",[encryptToken("unit-refresh-token")]);}
describe("real Calendar adapter contract, mocked HTTP",()=>{
  it('returns only to an exact local company conversation, never an external or injected path',()=>{
    const path='/opportunities/00000000-0000-0000-0000-000000000007?tab=conversation';expect(calendarReturnPath(path)).toBe(path);
    for(const value of ['//evil.example','https://evil.example',path+'&next=https://evil.example','/api/mvp/automation',undefined])expect(calendarReturnPath(value)).toBe('/outreach');
  });
  it("creates a browser-bound expiring state and exact local redirect URI",async()=>{
    const c=await beginCalendarConnection();const url=new URL(c.url);
    expect(url.origin).toBe("https://accounts.google.com");expect(url.searchParams.get("state")).toBe(c.state);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3007/api/mvp/automation/calendar/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");expect(url.searchParams.get("scope")).not.toContain("gmail");
    await expect(finishCalendarConnection("code",c.state,"wrong-browser")).rejects.toThrow("does not match");expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stores only encrypted refresh tokens for the approved owner account and prevents state replay",async()=>{
    const c=await beginCalendarConnection();fetchMock.mockResolvedValueOnce(response({access_token:"unit-access",refresh_token:"unit-refresh"})).mockResolvedValueOnce(response({id:"deeptendukuri@gmail.com",accessRole:"owner"}));
    await finishCalendarConnection("code",c.state,c.state);
    const row=(await db.query<{encrypted_refresh_token:string}>("select encrypted_refresh_token from funnel_integrations")).rows[0];expect(row.encrypted_refresh_token).not.toContain("unit-refresh");
    await expect(finishCalendarConnection("code",c.state,c.state)).rejects.toThrow("already used");expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects a different Google account instead of booking outside the approved Gmail",async()=>{
    const c=await beginCalendarConnection();fetchMock.mockResolvedValueOnce(response({access_token:"unit-access",refresh_token:"unit-refresh"})).mockResolvedValueOnce(response({id:"buyer@example.com",accessRole:"owner"}));
    await expect(finishCalendarConnection("code",c.state,c.state)).rejects.toThrow("Connect only");expect((await db.query("select * from funnel_integrations")).rows).toHaveLength(0);
  });
  it("rechecks actual busy time, creates Meet through Calendar and invites only the approved address",async()=>{
    await connected();const id=eventId("unit-thread");
    fetchMock.mockResolvedValueOnce(response({access_token:"unit-access"})).mockResolvedValueOnce(response({},404))
      .mockResolvedValueOnce(response({calendars:{"deeptendukuri@gmail.com":{busy:[]}}}))
      .mockResolvedValueOnce(response({id,conferenceData:{entryPoints:[{entryPointType:"video",uri:"https://meet.google.com/abc-defg-hij"}]}}));
    expect(await bookDemoMeeting("unit-thread","2026-10-12T04:30:00.000Z","Line pipe")).toEqual({id,url:"https://meet.google.com/abc-defg-hij"});
    const call=fetchMock.mock.calls.at(-1)!;expect(call[0]).toContain("conferenceDataVersion=1");expect(call[0]).toContain("sendUpdates=all");
    const body=JSON.parse(call[1].body);expect(body.attendees).toEqual([{email:"deeptendukuri@gmail.com"}]);expect(body.id).toBe(id);expect(body.end.dateTime).toBe("2026-10-12T05:00:00.000Z");
    expect(body.conferenceData.createRequest.conferenceSolutionKey.type).toBe("hangoutsMeet");
  });
  it("does not create an event when the chosen slot is occupied",async()=>{
    await connected();fetchMock.mockResolvedValueOnce(response({access_token:"unit-access"})).mockResolvedValueOnce(response({},404))
      .mockResolvedValueOnce(response({calendars:{"deeptendukuri@gmail.com":{busy:[{start:"2026-10-12T04:30:00Z",end:"2026-10-12T05:30:00Z"}]}}}));
    await expect(bookDemoMeeting("unit-thread","2026-10-12T04:30:00.000Z","Line pipe")).rejects.toThrow("no longer free");
    expect(fetchMock.mock.calls.some(c=>String(c[0]).includes("conferenceDataVersion"))).toBe(false);
  });
  it("recovers an existing event without a second insertion and keeps an unfinished Meet link pending",async()=>{
    await connected();const id=eventId("unit-thread");fetchMock.mockResolvedValueOnce(response({access_token:"unit-access"})).mockResolvedValueOnce(response({id,start:{dateTime:"2026-10-12T04:30:00Z"},conferenceData:{createRequest:{status:{statusCode:"pending"}}}}));
    expect(await bookDemoMeeting("unit-thread","2026-10-12T04:30:00.000Z","Line pipe")).toEqual({id,url:null});expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
