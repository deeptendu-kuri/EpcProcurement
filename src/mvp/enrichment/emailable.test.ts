// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {createTestDb,setDbForTests,type Db} from "@/mvp/db";
import {verifyEmailableEmail} from "./emailable";
let db:Db;const fetchMock=vi.fn();
const result={email:"jane@buyer.co",state:"deliverable",accept_all:false,disposable:false,role:false,no_reply:false,mailbox_full:false,mx_record:"mx.buyer.co"};
beforeAll(async()=>{db=await createTestDb();setDbForTests(db);},120_000);
afterAll(async()=>{setDbForTests(undefined);await db?.close();});
beforeEach(async()=>{vi.stubEnv("EMAILABLE_API_KEY","live_unit_not_real");vi.stubEnv("EMAILABLE_DAILY_REQUEST_LIMIT","2");fetchMock.mockReset();vi.stubGlobal("fetch",fetchMock);await db.exec("delete from contact_verification_requests");});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe("live Emailable validation",()=>{
  it("uses a private header, requests SMTP/catch-all checks and caches the actual verification time",async()=>{
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result),{status:200}));
    const first=await verifyEmailableEmail(result.email,"buyer.co");expect(first.deliverable).toBe(true);
    expect(await verifyEmailableEmail(result.email,"buyer.co")).toEqual(first);expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url,options]=fetchMock.mock.calls[0];expect(url.searchParams.get("api_key")).toBeNull();expect(url.searchParams.get("accept_all")).toBe("true");expect(options.headers.authorization).toBe("Bearer live_unit_not_real");
  });
  it("does not validate risky, unknown, generic, catch-all or mismatched identities",async()=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({...result,accept_all:true}),{status:200}));
    expect((await verifyEmailableEmail(result.email,"buyer.co")).deliverable).toBe(false);
    await db.exec("delete from contact_verification_requests");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({...result,email:"different@buyer.co"}),{status:200}));
    await expect(verifyEmailableEmail(result.email,"buyer.co")).rejects.toThrow("mismatched");
    await expect(verifyEmailableEmail("info@buyer.co","buyer.co")).rejects.toThrow("named address");
    await expect(verifyEmailableEmail("jane@other.co","buyer.co")).rejects.toThrow("named address");
  });
  it("rejects test keys and enforces a durable two-call daily budget",async()=>{
    vi.stubEnv("EMAILABLE_API_KEY","test_unit");await expect(verifyEmailableEmail(result.email,"buyer.co")).rejects.toThrow("live");expect(fetchMock).not.toHaveBeenCalled();
    vi.stubEnv("EMAILABLE_API_KEY","live_unit");fetchMock.mockImplementation(async(url:URL)=>new Response(JSON.stringify({...result,email:url.searchParams.get("email")}),{status:200}));
    await verifyEmailableEmail(result.email,"buyer.co");await verifyEmailableEmail("second@buyer.co","buyer.co");
    await expect(verifyEmailableEmail("third@buyer.co","buyer.co")).rejects.toMatchObject({status:429});expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("does not automatically retry a timeout or failed verification",async()=>{
    fetchMock.mockRejectedValue(new Error("network failure containing secrets"));
    await expect(verifyEmailableEmail(result.email,"buyer.co")).rejects.toThrow("No contact was validated");
    await expect(verifyEmailableEmail(result.email,"buyer.co")).rejects.toMatchObject({status:429});expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
