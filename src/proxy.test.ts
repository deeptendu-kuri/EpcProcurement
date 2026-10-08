// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE, createSessionToken } from "@/mvp/auth/session";
import { config, proxy } from "./proxy";

const SECRET = "proxy-test-secret-at-least-32-characters!!";
const saved = { password: process.env.DEMO_PASSWORD, secret: process.env.SESSION_SECRET };

function request(path: string, cookie?: string) {
  const headers = new Headers();
  if (cookie) headers.set("cookie", `${SESSION_COOKIE}=${cookie}`);
  return new NextRequest(new URL(path, "http://localhost:3000"), { headers });
}

function passedThrough(response: Response) {
  return response.headers.get("x-middleware-next") === "1";
}

const PROTECTED_PAGES = ["/", "/find", "/leads", "/leads/abc", "/settings", "/legacy", "/legacy/discovery"];
const PROTECTED_APIS = [
  "/api/health",
  "/api/opportunities",
  "/api/discovery/run",
  "/api/discovery/crm",
  "/api/discovery/contact-search",
  "/api/mvp/runs",
  "/api/mvp/runs/00000000-0000-4000-8000-000000000001",
  "/api/mvp/leads",
  "/api/mvp/logout",
  "/api/mvp/outreach/campaigns",
  "/api/mvp/outreach/campaigns/abc",
  "/api/mvp/opportunities/abc/enrichment",
];

beforeEach(() => {
  process.env.DEMO_PASSWORD = "demo-pass";
  process.env.SESSION_SECRET = SECRET;
});

afterEach(() => {
  process.env.DEMO_PASSWORD = saved.password;
  process.env.SESSION_SECRET = saved.secret;
  if (saved.password === undefined) delete process.env.DEMO_PASSWORD;
  if (saved.secret === undefined) delete process.env.SESSION_SECRET;
});

describe("proxy session gate", () => {
  it.each(PROTECTED_PAGES)("redirects %s to /login without a session", async (path) => {
    const response = await proxy(request(path));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
  });

  it("keeps the requested page as ?next", async () => {
    const response = await proxy(request("/leads?tab=genuine"));
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/leads?tab=genuine");
  });

  it.each(PROTECTED_APIS)("returns 401 JSON for %s without a session", async (path) => {
    const response = await proxy(request(path));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not signed in." });
  });

  it("rejects a forged or foreign-secret cookie", async () => {
    const foreign = await createSessionToken("another-secret-that-is-32-characters-long");
    expect((await proxy(request("/api/health", foreign))).status).toBe(401);
    expect((await proxy(request("/api/health", "v1.9999999999999.x.y"))).status).toBe(401);
  });

  it("lets a valid session through to pages and APIs", async () => {
    const token = await createSessionToken(SECRET);
    for (const path of [...PROTECTED_PAGES, ...PROTECTED_APIS]) {
      expect(passedThrough(await proxy(request(path, token)))).toBe(true);
    }
  });

  it("leaves /login and the login API public", async () => {
    expect(passedThrough(await proxy(request("/login")))).toBe(true);
    expect(passedThrough(await proxy(request("/api/mvp/login")))).toBe(true);
  });

  it("delegates only the exact machine endpoint to its own bearer authentication", async () => {
    expect(passedThrough(await proxy(request("/api/mvp/outreach/worker")))).toBe(true);
    expect((await proxy(request("/api/mvp/outreach/worker/extra"))).status).toBe(401);
    for(const path of ['/api/mvp/research/worker','/api/mvp/webhooks/resend']){
      expect(passedThrough(await proxy(request(path)))).toBe(true);
      expect((await proxy(request(`${path}/extra`))).status).toBe(401);
    }
  });

  const EXTENSION_PAGES = ["/legacy/lead-lists/x.png", "/leads/x.css", "/legacy/companies/a.svg", "/find/x.woff2"];
  const EXTENSION_APIS = ["/api/mvp/leads/x.png", "/api/mvp/runs/x.map"];

  it.each(EXTENSION_PAGES)("gates extension-suffixed page %s", async (path) => {
    expect((await proxy(request(path))).status).toBe(307);
  });

  it.each(EXTENSION_APIS)("gates extension-suffixed API %s", async (path) => {
    expect((await proxy(request(path))).status).toBe(401);
  });

  it("matcher runs the proxy on extension-suffixed paths and skips only build assets", () => {
    // Next compiles the matcher source as an anchored regex; mirror that here.
    const matchers = (config.matcher as string[]).map((m) => new RegExp(`^${m}$`));
    const runs = (path: string) => matchers.some((re) => re.test(path));
    for (const path of [...PROTECTED_PAGES, ...PROTECTED_APIS, ...EXTENSION_PAGES, ...EXTENSION_APIS, "/login"]) {
      expect(runs(path), path).toBe(true);
    }
    for (const path of ["/_next/static/chunks/app.js", "/_next/image", "/favicon.ico", "/robots.txt"]) {
      expect(runs(path), path).toBe(false);
    }
  });

  it("fails closed when auth is not configured", async () => {
    delete process.env.SESSION_SECRET;
    const token = await createSessionToken(SECRET);
    const api = await proxy(request("/api/health", token));
    expect(api.status).toBe(503);
    const page = await proxy(request("/find", token));
    expect(new URL(page.headers.get("location")!).pathname).toBe("/login");
    expect(passedThrough(await proxy(request("/login")))).toBe(true);
  });
});
