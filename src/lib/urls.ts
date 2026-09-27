export function normalizeUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.searchParams.sort();
  if (url.pathname.endsWith("/") && url.pathname !== "/") {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function domainFromUrl(input: string): string {
  return new URL(input).hostname.replace(/^www\./, "");
}
