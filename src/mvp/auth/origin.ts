/** Explicit public origin avoids redirects to an internal hostname behind a cloud proxy. */
export function publicOrigin(requestUrl: string): string {
  const configured = process.env.APP_URL?.trim();
  if (!configured) return new URL(requestUrl).origin;
  const url = new URL(configured);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error("APP_URL must be an HTTP(S) origin without a path or credentials.");
  return url.origin;
}
