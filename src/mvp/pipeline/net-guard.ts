/**
 * SSRF guard for URLs that come from third parties (GDELT article URLs, RSS links, RSS_FEEDS).
 *
 * A URL may be fetched only when it is http(s) on the default port and every address its host
 * resolves to is public: no loopback, private (RFC 1918), link-local (incl. cloud metadata
 * 169.254.169.254), CGNAT, multicast/reserved, ::1, fc00::/7 or fe80::/10. The read step runs the
 * guard on every redirect hop, and the node:http fallback also pins the check into DNS lookup.
 */
import { lookup as dnsLookupCb, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

const g = globalThis as unknown as { __mvpAllowLocalFetch?: boolean };

/** Tests only: allow loopback hosts and non-default ports (local test servers). */
export function allowLocalFetchForTests(allow: boolean): void {
  g.__mvpAllowLocalFetch = allow;
}

function localAllowed(): boolean {
  return g.__mvpAllowLocalFetch === true;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => acc * 256 + Number(part), 0);
}

function inV4(ip: number, base: string, bits: number): boolean {
  const size = 2 ** (32 - bits);
  const start = ipv4ToInt(base);
  return ip >= start && ip < start + size;
}

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
];

/** Expand an IPv6 address to 8 16-bit groups (handles "::" and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] | null {
  let addr = ip.toLowerCase().replace(/%.*$/, "");
  const v4 = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = ipv4ToInt(v4[1]);
    addr = addr.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const [head, tail] = addr.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (addr.includes("::") ? missing < 0 : missing !== 0) return null;
  const parts = [...headParts, ...Array(addr.includes("::") ? missing : 0).fill("0"), ...tailParts];
  const groups = parts.map((p) => parseInt(p, 16));
  return groups.length === 8 && groups.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? groups : null;
}

/** True when `ip` (v4 or v6 literal) is a public unicast address. Unknown formats count as not public. */
export function isPublicIp(ip: string): boolean {
  const version = isIP(ip.replace(/%.*$/, ""));
  if (version === 4) {
    const n = ipv4ToInt(ip);
    return !BLOCKED_V4.some(([base, bits]) => inV4(n, base, bits));
  }
  if (version !== 6) return false;
  const groups = ipv6Groups(ip);
  if (!groups) return false;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96): check the IPv4.
  const embedded = (hi: number, lo: number) => `${hi >>> 8}.${hi & 0xff}.${lo >>> 8}.${lo & 0xff}`;
  if (groups.slice(0, 5).every((x) => x === 0) && (groups[5] === 0xffff || groups[5] === 0)) {
    if (groups[5] === 0 && groups[6] === 0 && groups[7] <= 1) return false; // :: and ::1
    return isPublicIp(embedded(groups[6], groups[7]));
  }
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((x) => x === 0))
    return isPublicIp(embedded(groups[6], groups[7]));
  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xffc0) === 0xfec0) return false; // fec0::/10 site-local (deprecated)
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  return true;
}

/** Synchronous shape check: http(s), no credentials, default port. Returns the parsed URL. */
export function checkHttpUrlShape(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new BlockedUrlError(`blocked url (unparseable): ${url.slice(0, 200)}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new BlockedUrlError(`blocked url (scheme ${u.protocol})`);
  if (u.username || u.password) throw new BlockedUrlError("blocked url (credentials in url)");
  if (u.port && !localAllowed()) throw new BlockedUrlError(`blocked url (non-default port ${u.port})`);
  return u;
}

/** True for an http(s) URL string (used to drop javascript:/data:/file: links from feeds). */
export function isHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Throws BlockedUrlError unless `url` is http(s), default port, and resolves only to public addresses. */
export async function assertPublicHttpUrl(url: string): Promise<URL> {
  const u = checkHttpUrlShape(url);
  if (localAllowed()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new BlockedUrlError(`blocked url (non-public address ${host})`);
    return u;
  }
  let addresses: LookupAddress[];
  try {
    addresses = await dnsLookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`DNS lookup failed for ${host}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!addresses.length) throw new Error(`DNS lookup returned no address for ${host}`);
  const bad = addresses.find((a) => !isPublicIp(a.address));
  if (bad) throw new BlockedUrlError(`blocked url (${host} resolves to non-public address ${bad.address})`);
  return u;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/**
 * dns.lookup replacement for node:http(s) requests: refuses to connect to non-public addresses, so a
 * DNS answer that changes between the check and the connect (rebinding) is still blocked.
 */
export function guardedLookup(hostname: string, options: LookupOptions | LookupCallback, callback?: LookupCallback): void {
  const cb = (typeof options === "function" ? options : callback) as LookupCallback;
  const opts: LookupOptions = typeof options === "function" ? {} : options;
  dnsLookupCb(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err) return cb(err, opts.all ? [] : "", undefined);
    const list = addresses as LookupAddress[];
    if (!localAllowed()) {
      const bad = list.find((a) => !isPublicIp(a.address));
      if (bad) return cb(new BlockedUrlError(`blocked url (${hostname} resolves to non-public address ${bad.address})`), opts.all ? [] : "", undefined);
    }
    if (opts.all) return cb(null, list);
    const first = list[0];
    if (!first) return cb(Object.assign(new Error(`no address for ${hostname}`), { code: "ENOTFOUND" }), "", undefined);
    cb(null, first.address, first.family);
  });
}
