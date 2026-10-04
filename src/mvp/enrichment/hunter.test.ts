// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { companyDomain, findHunterEmail, hunterConfigured, searchHunter, verifyHunterEmail } from "./hunter";
const fetchMock = vi.fn();
const good = { email: "jane@buyer.co", status: "valid", regexp: true, gibberish: false, disposable: false,
  webmail: false, mx_records: true, smtp_server: true, smtp_check: true, accept_all: false, block: false };
const respond = (data: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify({ data }), { status: 200 }));
beforeEach(() => { vi.stubEnv("HUNTER_API_KEY", "unit-test-private-key"); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Hunter adapter boundaries", () => {
  it("normalizes domains but rejects URLs, private/test hosts and arbitrary query injection", () => {
    expect(companyDomain(" WWW.BUYER.CO ")).toBe("buyer.co");
    for (const domain of ["http://buyer.co", "buyer.co/path", "buyer.co?api_key=oops", "localhost", "127.0.0.1", "buyer.local", "buyer.test", "example.com"])
      expect(() => companyDomain(domain)).toThrow();
  });
  it("refuses missing or Hunter's dummy-response key before making any request", async () => {
    for (const key of ["", "test-api-key"]) {
      vi.stubEnv("HUNTER_API_KEY", key); expect(hunterConfigured()).toBe(false);
      await expect(searchHunter("buyer.co")).rejects.toMatchObject({ status: 503 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("requests only five personal emails, keeps the key out of URLs and excludes nameless/shared contacts", async () => {
    const candidate = { value: "jane@buyer.co", type: "personal", first_name: "Jane", last_name: "Doe", position: "Procurement Manager", sources: [{ uri: "https://buyer.co/team" }] };
    respond({ domain: "buyer.co", emails: [candidate, { ...candidate, first_name: null }, { ...candidate, value: "sales@buyer.co" }, { ...candidate, value: "jane@other.co" }] });
    expect(await searchHunter("buyer.co")).toEqual([{ name: "Jane Doe", title: "Procurement Manager", email: "jane@buyer.co", sources: ["https://buyer.co/team"] }]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("limit=5"); expect(String(url)).toContain("type=personal");
    expect(String(url)).not.toContain("private-key"); expect(options.headers["X-API-KEY"]).toBe("unit-test-private-key");
    expect(options.redirect).toBe("error");
  });
  it("finds an email only for the requested name and confirmed business domain", async () => {
    respond({ email: "jane@buyer.co", first_name: "Jane", last_name: "Doe", domain: "buyer.co" });
    expect(await findHunterEmail("buyer.co", "Jane Doe")).toBe("jane@buyer.co");
    respond({ email: "bob@buyer.co", first_name: "Bob", last_name: "Doe" });
    await expect(findHunterEmail("buyer.co", "Jane Doe")).rejects.toMatchObject({ status: 502 });
    await expect(findHunterEmail("buyer.co", "Jane")).rejects.toMatchObject({ status: 409 });
    respond({ email: null }); expect(await findHunterEmail("buyer.co", "Jane Doe")).toBeNull();
  });
  it("validates only a complete positive verifier result and returns a real check timestamp", async () => {
    respond(good); const result = await verifyHunterEmail(good.email, "buyer.co");
    expect(result.deliverable).toBe(true); expect(result.checkedAt).toMatch(/^\d{4}-/);
    for (const patch of [{ accept_all: true }, { status: "accept_all" }, { status: "unknown" }, { status: "invalid" },
      { webmail: true }, { disposable: true }, { block: true }, { smtp_check: false }, { mx_records: false }]) {
      respond({ ...good, ...patch }); expect((await verifyHunterEmail(good.email, "buyer.co")).deliverable).toBe(false);
    }
  });
  it("rejects incomplete, wrong-email and wrong-company results without claiming validation", async () => {
    respond({ email: good.email, status: "valid" });
    await expect(verifyHunterEmail(good.email, "buyer.co")).rejects.toMatchObject({ status: 502 });
    respond({ ...good, email: "other@buyer.co" });
    await expect(verifyHunterEmail(good.email, "buyer.co")).rejects.toMatchObject({ status: 502 });
    await expect(verifyHunterEmail("jane@other.co", "buyer.co")).rejects.toMatchObject({ status: 409 });
  });
  it("exposes actionable quota/auth failures, never provider payloads or keys, and never retries automatically", async () => {
    for (const code of [401, 403, 429, 500]) {
      fetchMock.mockResolvedValue(new Response("unit-test-private-key secret error payload", { status: code }));
      await expect(searchHunter("buyer.co")).rejects.toMatchObject({ status: [403,429].includes(code) ? 429 : 502 });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
