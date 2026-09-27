// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, getText, timedFetch } from "./read";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
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
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

describe("timedFetch / getText", () => {
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
