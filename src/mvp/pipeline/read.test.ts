// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BlockedUrlError, allowLocalFetchForTests, assertPublicHttpUrl, isPublicIp } from "./net-guard";
import { MAX_BODY_BYTES, fetchPageText, getText, timedFetch, htmlToText } from "./read";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/to-metadata") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
      res.end();
      return;
    }
    if (req.url === "/loop") {
      res.writeHead(302, { location: "/loop" });
      res.end();
      return;
    }
    if (req.url === "/drip") {
      // Headers arrive at once, then the body drips forever.
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
      const timer = setInterval(() => res.write("."), 50);
      res.on("close", () => clearInterval(timer));
      return;
    }
    if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = "x".repeat(64 * 1024);
      let sent = 0;
      const pump = () => {
        while (sent < MAX_BODY_BYTES * 2) {
          sent += chunk.length;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      res.on("error", () => undefined);
      pump();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("hello");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  allowLocalFetchForTests(false);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("timedFetch / getText", () => {
  beforeAll(() => allowLocalFetchForTests(true));
  it("reads a normal body", async () => {
    const res = await getText(`${base}/ok`);
    expect(res.ok).toBe(true);
    expect(res.text).toBe("hello");
    expect(res.truncated).toBe(false);
  });

  it("aborts a slow-drip body at the total deadline", async () => {
    const started = Date.now();
    await expect(timedFetch(`${base}/drip`, {}, 400)).rejects.toMatchObject({ name: "AbortError" });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("caps a huge body at MAX_BODY_BYTES", async () => {
    const res = await timedFetch(`${base}/huge`, {}, 10_000);
    expect(res.truncated).toBe(true);
    expect(res.text.length).toBe(MAX_BODY_BYTES);
  });
});
describe("article-only HTML extraction",()=>{
  it("keeps original footer telephone/inbox details in full-page contact mode but excludes scripts",async()=>{
    const page=await htmlToText('<html><head><title>Buyer contacts</title></head><body><main><p>Original business content</p></main><footer><p>Phone +91 22 3064 2100</p><p>info@buyer.co</p></footer><script>const email="fake@buyer.co";</script></body></html>',"https://buyer.co/contact",true);
    expect(page.text).toContain("+91 22 3064 2100");expect(page.text).toContain("info@buyer.co");expect(page.text).not.toContain("fake@buyer.co");
  },30_000);
  it("keeps real article text and publication metadata while excluding large styles and script-only fake contacts",async()=>{
    const css='@supports (display:grid){.nested{color:red}}'.repeat(1000);
    const page=await htmlToText(`<html><head><title>Contract award</title><style>${css}</style><script type="application/ld+json">{"datePublished":"2026-10-01"}</script></head><body><article><h1>Contract award</h1><p>Unit EPC won a pipeline construction contract, including line pipe procurement.</p></article><script>const fabricatedContact="Fake Person, CEO, fake@buyer.co";</script><noscript>Tracking text</noscript></body></html>`,"https://buyer.co/award");
    expect(page.text).toContain("Unit EPC won a pipeline construction contract");expect(page.text).not.toMatch(/nested|Fake Person|fake@buyer.co|Tracking text/);
    expect(page.publishedAt).toBe("2026-10-01T00:00:00.000Z");
  },30_000); // jsdom's cold import can be slow alongside the full database-test suite.
});

describe("SSRF guard", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe"])
      expect(isPublicIp(ip), ip).toBe(false);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicIp(ip), ip).toBe(true);
  });

  it("rejects non-http schemes, odd ports, loopback and private hosts", async () => {
    allowLocalFetchForTests(false);
    for (const url of ["file:///etc/passwd", "ftp://example.com/", "http://example.com:8080/", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/", "http://10.0.0.5/", "http://localhost/"])
      await expect(assertPublicHttpUrl(url), url).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("fetchPageText refuses a loopback URL without requesting it", async () => {
    allowLocalFetchForTests(false);
    const out = await fetchPageText(`${base}/ok`);
    expect(out.ok).toBe(false);
  });

  it("re-checks every redirect hop (redirect to cloud metadata is blocked)", async () => {
    // Allow the local test server itself, but the redirect target is checked by isPublicIp via the hop guard.
    allowLocalFetchForTests(true);
    const hops: string[] = [];
    await expect(
      timedFetch(`${base}/to-metadata`, {}, 5_000, MAX_BODY_BYTES, {
        beforeHop: async (url) => {
          hops.push(url);
          if (!isPublicIp(new URL(url).hostname)) throw new BlockedUrlError(`blocked ${url}`);
        },
      }),
    ).rejects.toBeInstanceOf(BlockedUrlError);
    expect(hops).toEqual(["http://169.254.169.254/latest/meta-data/"]);
  });

  it("the guard itself blocks a public URL that redirects to a private address", async () => {
    allowLocalFetchForTests(false);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
    });
    try {
      await expect(timedFetch("http://8.8.8.8/article", {}, 5_000)).rejects.toBeInstanceOf(BlockedUrlError);
      expect(calls).toEqual(["http://8.8.8.8/article"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stops after too many redirects", async () => {
    allowLocalFetchForTests(true);
    await expect(getText(`${base}/loop`, undefined, 5_000)).rejects.toThrow(/too many redirects/);
  });
});
