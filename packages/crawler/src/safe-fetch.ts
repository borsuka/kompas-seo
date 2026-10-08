import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';
import { assertFetchableUrl, BlockedUrlError, isBlockedAddress } from './network.js';

export const CRAWLER_USER_AGENT = 'KompasSEOBot/1.0 (+https://kompas-seo.eu/bot)';

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  /** Accepted content types (prefix match). Others fail with `unsupported_content`. */
  accept?: readonly string[];
  /** Tests only: allow loopback/private targets (a local test server). */
  unsafeAllowPrivateNetworks?: boolean;
  /** Called before every request (including redirect hops); throw to stop. */
  beforeRequest?: (url: URL) => Promise<void>;
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  redirects: string[];
}

export class FetchFailedError extends Error {
  constructor(
    message: string,
    readonly reason:
      'timeout' | 'too_large' | 'too_many_redirects' | 'unsupported_content' | 'network',
  ) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

/**
 * DNS lookup that rejects blocked addresses. It runs when the socket connects, so the
 * address that is checked is the one used (no DNS rebinding between check and connect).
 */
export function safeLookup(allowPrivate = false): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((a) => !allowPrivate && isBlockedAddress(a.address));
      if (bad || !list.length)
        return callback(
          new BlockedUrlError(`Address not allowed for ${hostname}`, 'address'),
          '',
          0,
        );
      if (options.all)
        return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list);
      callback(null, list[0]!.address, list[0]!.family);
    });
  };
}

function decode(stream: Readable, encoding: string | undefined): Readable {
  switch (encoding?.toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return stream.pipe(createGunzip());
    case 'deflate':
      return stream.pipe(createInflate());
    case 'br':
      return stream.pipe(createBrotliDecompress());
    default:
      return stream;
  }
}

function once(
  url: URL,
  opts: Required<Omit<SafeFetchOptions, 'unsafeAllowPrivateNetworks' | 'beforeRequest'>> & {
    allowPrivate: boolean;
  },
) {
  return new Promise<{ status: number; headers: Record<string, string>; body: string }>(
    (resolve, reject) => {
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.request(
        url,
        {
          method: 'GET',
          lookup: safeLookup(opts.allowPrivate),
          headers: {
            'User-Agent': opts.userAgent,
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'bg,en;q=0.8',
          },
          timeout: opts.timeoutMs,
        },
        (res) => {
          const headers = Object.fromEntries(
            Object.entries(res.headers).map(([k, v]) => [
              k,
              Array.isArray(v) ? v.join(', ') : String(v ?? ''),
            ]),
          );
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.resume();
            return resolve({ status, headers, body: '' });
          }
          const type = (headers['content-type'] ?? '').toLowerCase();
          if (status < 400 && opts.accept.length && !opts.accept.some((a) => type.startsWith(a))) {
            res.destroy();
            return reject(
              new FetchFailedError(`Unsupported content type: ${type}`, 'unsupported_content'),
            );
          }
          const declared = Number(headers['content-length'] ?? 0);
          if (declared > opts.maxBytes) {
            res.destroy();
            return reject(new FetchFailedError('Response too large', 'too_large'));
          }
          const chunks: Buffer[] = [];
          let size = 0;
          const body = decode(res, headers['content-encoding']);
          body.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > opts.maxBytes) {
              body.destroy();
              res.destroy();
              reject(new FetchFailedError('Response too large', 'too_large'));
              return;
            }
            chunks.push(chunk);
          });
          body.on('end', () =>
            resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8') }),
          );
          body.on('error', (err) => reject(new FetchFailedError(err.message, 'network')));
        },
      );
      req.on('timeout', () => req.destroy(new FetchFailedError('Timed out', 'timeout')));
      req.on('error', (err) =>
        reject(
          err instanceof BlockedUrlError || err instanceof FetchFailedError
            ? err
            : new FetchFailedError(err.message, 'network'),
        ),
      );
      req.end();
    },
  );
}

/**
 * GET with SSRF protection: http(s) on ports 80/443 only, no credentials, every DNS answer
 * and every redirect hop validated, bounded time and size. Never sends cookies.
 */
export async function safeFetch(
  raw: string,
  options: SafeFetchOptions = {},
): Promise<SafeResponse> {
  const opts = {
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: options.maxBytes ?? 3 * 1024 * 1024,
    maxRedirects: options.maxRedirects ?? 5,
    userAgent: options.userAgent ?? CRAWLER_USER_AGENT,
    accept: options.accept ?? ['text/html', 'application/xhtml+xml'],
    allowPrivate: options.unsafeAllowPrivateNetworks === true,
  };
  const redirects: string[] = [];
  let url = opts.allowPrivate ? new URL(raw) : assertFetchableUrl(raw);
  for (let hop = 0; ; hop++) {
    await options.beforeRequest?.(url);
    const res = await once(url, opts);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      if (hop >= opts.maxRedirects)
        throw new FetchFailedError('Too many redirects', 'too_many_redirects');
      const next = new URL(res.headers.location, url);
      redirects.push(next.toString());
      url = opts.allowPrivate ? next : assertFetchableUrl(next);
      continue;
    }
    return {
      url: url.toString(),
      status: res.status,
      headers: res.headers,
      body: res.body,
      redirects,
    };
  }
}
