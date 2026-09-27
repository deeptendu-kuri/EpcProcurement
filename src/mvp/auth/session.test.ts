// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  authConfigError,
  createSessionToken,
  isPublicPath,
  passwordMatches,
  safeNextPath,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret-that-is-at-least-32-characters-long";

describe("session tokens", () => {
  it("verifies a token it signed", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, SECRET)).toBe(true);
  });

  it("rejects a token signed with another secret", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(token, `${SECRET}-other`)).toBe(false);
  });

  it("rejects an expired token (12 h TTL)", async () => {
    const now = Date.now();
    const token = await createSessionToken(SECRET, now);
    expect(await verifySessionToken(token, SECRET, now + SESSION_TTL_MS - 1000)).toBe(true);
    expect(await verifySessionToken(token, SECRET, now + SESSION_TTL_MS + 1)).toBe(false);
  });

  it("rejects tampered or malformed tokens", async () => {
    const token = await createSessionToken(SECRET);
    const [version, expires, nonce, signature] = token.split(".");
    const extended = `${version}.${Number(expires) + 1000}.${nonce}.${signature}`;
    expect(await verifySessionToken(extended, SECRET)).toBe(false);
    expect(await verifySessionToken(`${token}x`, SECRET)).toBe(false);
    expect(await verifySessionToken("garbage", SECRET)).toBe(false);
    expect(await verifySessionToken("", SECRET)).toBe(false);
    expect(await verifySessionToken(token, "")).toBe(false);
  });
});

describe("auth config", () => {
  it("fails closed when the password or secret is missing or weak", () => {
    expect(authConfigError({})).toMatch(/DEMO_PASSWORD and SESSION_SECRET/);
    expect(authConfigError({ SESSION_SECRET: SECRET })).toMatch(/DEMO_PASSWORD/);
    expect(authConfigError({ DEMO_PASSWORD: "pw" })).toMatch(/SESSION_SECRET/);
    expect(authConfigError({ DEMO_PASSWORD: "pw", SESSION_SECRET: "short" })).toMatch(/at least 32/);
    expect(authConfigError({ DEMO_PASSWORD: "pw", SESSION_SECRET: SECRET })).toBeNull();
  });

  it("compares passwords", async () => {
    expect(await passwordMatches("open sesame", "open sesame")).toBe(true);
    expect(await passwordMatches("open sesame!", "open sesame")).toBe(false);
    expect(await passwordMatches("", "open sesame")).toBe(false);
  });

  it("only exposes /login and the login API", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/api/mvp/login")).toBe(true);
    expect(isPublicPath("/api/mvp/logout")).toBe(false);
    expect(isPublicPath("/login/x")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });

  it("only allows relative redirect targets", () => {
    expect(safeNextPath("/leads?tab=genuine")).toBe("/leads?tab=genuine");
    expect(safeNextPath("//evil.example")).toBe("/find");
    expect(safeNextPath("https://evil.example")).toBe("/find");
    expect(safeNextPath("/\\evil.example")).toBe("/find");
    expect(safeNextPath(null)).toBe("/find");
    expect(safeNextPath("/api/mvp/leads")).toBe("/find");
  });
});
