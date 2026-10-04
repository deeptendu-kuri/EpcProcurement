// @vitest-environment node
import {describe,it,expect,afterEach,vi} from "vitest";
import {businessTime,freshReply,hardStop,selectedSlot,messageIdSafe} from "./policy";
import {chooseSlots,decryptToken,encryptToken,eventId} from "./calendar";
afterEach(()=>vi.unstubAllEnvs());
describe("bounded sales automation policy",()=>{
  it("ignores quoted old mail when deciding the buyer's latest intent",()=>{
    expect(freshReply('Yes, please send specs.\n\nOn Tue, Seller wrote:\nReply unsubscribe to stop')).toBe("Yes, please send specs.");
    expect(hardStop('Yes, please send specs.\n> Reply unsubscribe to stop')).toBeNull();
  });
  it("stops opt-out, rejection and automatic-response loops before AI",()=>{
    expect(hardStop("Please unsubscribe me")).toBe("opt_out");
    expect(hardStop("Not interested, thank you")).toBe("rejected");
    expect(hardStop("Back next week",{"Auto-Submitted":"auto-replied"})).toBe("auto_reply");
    expect(hardStop("I'm out of office")).toBe("auto_reply");
  });
  it("requires an unambiguous explicit selection of a previously offered slot",()=>{
    const slots=["2026-10-05T04:30:00.000Z","2026-10-06T04:30:00.000Z"];
    expect(selectedSlot("Please book slot 2",slots)).toBe(slots[1]);
    for(const text of ["Share a meeting link","Tomorrow at ten","Slot 1 is not available","Maybe option 1","Please book slot 1 or slot 2","Please book slot 3"])
      expect(selectedSlot(text,slots)).toBeNull();
  });
  it("respects timezone, weekends, working hours and real busy intervals",()=>{
    vi.stubEnv("SALES_TIMEZONE","Asia/Kolkata");vi.stubEnv("MEETING_DURATION_MINUTES","30");
    expect(businessTime(new Date("2026-10-05T04:30:00Z"),"Asia/Kolkata",10,18)).toBe(true);
    expect(businessTime(new Date("2026-10-04T04:30:00Z"),"Asia/Kolkata",10,18)).toBe(false);
    const slots=chooseSlots(new Date("2026-10-04T12:00:00Z"),[{start:"2026-10-05T04:30:00Z",end:"2026-10-05T05:00:00Z"}]);
    expect(slots).toHaveLength(3);expect(slots[0]).toBe("2026-10-05T05:00:00.000Z");
    expect(new Set(slots.map(s=>s.slice(0,10))).size).toBe(3);
  });
  it("encrypts Google refresh tokens and detects tampering/key rotation",()=>{
    vi.stubEnv("SESSION_SECRET","a".repeat(40));const cipher=encryptToken("test-refresh-only");
    expect(cipher).not.toContain("test-refresh-only");expect(decryptToken(cipher)).toBe("test-refresh-only");
    vi.stubEnv("SESSION_SECRET","b".repeat(40));expect(()=>decryptToken(cipher)).toThrow();
  });
  it("uses a deterministic legal Google event ID and rejects header injection",()=>{
    expect(eventId("thread1")).toMatch(/^[a-v0-9]+$/);expect(eventId("thread1")).toBe(eventId("thread1"));
    expect(messageIdSafe("<gmail-message@mail.gmail.com>")).toBe("<gmail-message@mail.gmail.com>");
    expect(messageIdSafe("resource-uuid")).toBeNull();expect(messageIdSafe("<bad>\r\nBcc: buyer@example.com")).toBeNull();
  });
});
