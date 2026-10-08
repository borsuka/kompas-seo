import { isIP } from 'node:net';

/**
 * SSRF protection: addresses a crawler must never connect to (loopback, private,
 * link-local incl. cloud metadata 169.254.169.254, CGNAT, multicast, reserved…).
 */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

const v4ToInt = (ip: string) =>
  ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

function inV4Range(ip: string, [base, bits]: [string, number]) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (v4ToInt(ip) & mask) === (v4ToInt(base) & mask);
}

/** Expands an IPv6 address to 8 hextets (handles "::" and embedded IPv4). */
function expandV6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0]!;
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  if (v4) {
    const n = v4ToInt(v4[1]!);
    addr = addr.replace(v4[1]!, `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`);
  }
  const [head, tail] = addr.split('::') as [string, string | undefined];
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = addr.includes('::') ? 8 - h.length - t.length : 0;
  const parts = [...h, ...Array<string>(missing).fill('0'), ...t];
  if (parts.length !== 8) return null;
  const nums = parts.map((p) => parseInt(p || '0', 16));
  return nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff) ? null : nums;
}

export function isBlockedAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return BLOCKED_V4.some((r) => inV4Range(ip, r));
  if (family !== 6) return true;
  const h = expandV6(ip);
  if (!h) return true;
  const allZero = h.slice(0, 7).every((x) => x === 0);
  if (allZero && (h[7] === 0 || h[7] === 1)) return true; // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible: check the embedded IPv4.
  if (h.slice(0, 5).every((x) => x === 0) && (h[5] === 0xffff || h[5] === 0)) {
    const v4 = `${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.${h[7]! & 0xff}`;
    return isBlockedAddress(v4);
  }
  if ((h[0]! & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h[0]! & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  if ((h[0]! & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentation
  if (h[0] === 0x0064 && h[1] === 0xff9b) return true; // NAT64 → may reach private v4
  return false;
}

export class BlockedUrlError extends Error {
  constructor(
    message: string,
    readonly reason: 'protocol' | 'credentials' | 'port' | 'host' | 'address',
  ) {
    super(message);
    this.name = 'BlockedUrlError';
  }
}

const ALLOWED_PORTS = new Set(['', '80', '443']);

/** Syntactic checks before any network access. DNS answers are validated at connect time. */
export function assertFetchableUrl(raw: string | URL): URL {
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new BlockedUrlError(`Protocol not allowed: ${url.protocol}`, 'protocol');
  if (url.username || url.password) throw new BlockedUrlError('Credentials in URL', 'credentials');
  if (!ALLOWED_PORTS.has(url.port))
    throw new BlockedUrlError(`Port not allowed: ${url.port}`, 'port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host.endsWith('.local')
  )
    throw new BlockedUrlError(`Host not allowed: ${host}`, 'host');
  if (isIP(host) && isBlockedAddress(host))
    throw new BlockedUrlError(`Address not allowed: ${host}`, 'address');
  return url;
}
