/**
 * Demo-password session (docs/mvp/12 §2). Edge/Node-safe: Web Crypto only, no Node APIs.
 *
 * Token format: `v1.<expiresAtMs>.<nonce>.<hmacSha256Base64url>` where the HMAC (key = SESSION_SECRET)
 * covers `v1.<expiresAtMs>.<nonce>`. Stored in an httpOnly cookie; valid for 12 hours.
 */

export const SESSION_COOKIE = "ibi_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MIN_SECRET_LENGTH = 32;

const encoder = new TextEncoder();

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * Why auth can't work with the current environment, or null when it can.
 * Fail closed: when this returns a message, nobody can log in.
 */
export function authConfigError(env: Record<string, string | undefined> = process.env): string | null {
  const password = env.DEMO_PASSWORD?.trim();
  const secret = env.SESSION_SECRET?.trim();
  if (!password && !secret) return "DEMO_PASSWORD and SESSION_SECRET are not set. Add them to .env.local and restart.";
  if (!password) return "DEMO_PASSWORD is not set. Add it to .env.local and restart.";
  if (!secret) return "SESSION_SECRET is not set. Add it to .env.local and restart.";
  if (secret.length < MIN_SECRET_LENGTH) return `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`;
  return null;
}

/** Create a signed session token that expires `SESSION_TTL_MS` after `now`. */
export async function createSessionToken(secret: string, now: number = Date.now()): Promise<string> {
  const nonce = toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
  const payload = `v1.${now + SESSION_TTL_MS}.${nonce}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${toBase64Url(signature)}`;
}

/** True when `token` was signed with `secret` and has not expired. Constant-time signature check. */
export async function verifySessionToken(
  token: string | undefined | null,
  secret: string | undefined | null,
  now: number = Date.now(),
): Promise<boolean> {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return false;
  const [version, expires, nonce, signature] = parts;
  const expiresAt = Number(expires);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  if (expiresAt > now + SESSION_TTL_MS + 60_000) return false; // not issued by us (TTL too long)
  const signatureBytes = fromBase64Url(signature);
  if (!signatureBytes || !nonce) return false;
  try {
    return await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      signatureBytes,
      encoder.encode(`${version}.${expires}.${nonce}`),
    );
  } catch {
    return false;
  }
}

/** Constant-time password comparison (compares HMAC digests of both values). */
export async function passwordMatches(candidate: string, expected: string): Promise<boolean> {
  const key = await crypto.subtle.importKey("raw", crypto.getRandomValues(new Uint8Array(32)), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const [a, b] = await Promise.all([
    crypto.subtle.sign("HMAC", key, encoder.encode(candidate)),
    crypto.subtle.sign("HMAC", key, encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

/** Paths reachable without a session. Everything else (pages and /api/*) requires one. */
export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/api/mvp/login";
}

/** Only allow same-site relative redirect targets after login. */
export function safeNextPath(next: string | null | undefined, fallback = "/find"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (next === "/login" || next.startsWith("/api/")) return fallback;
  return next;
}
