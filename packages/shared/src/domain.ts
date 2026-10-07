import { z } from 'zod';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normalizes user input into a registrable host name:
 * lowercases, strips protocol, path, port, `www.` and trailing dot, and converts
 * IDNs (e.g. `пример.бг`) to punycode (`xn--e1afmkfd.xn--90ae`) via WHATWG URL,
 * which behaves identically in Node and browsers.
 *
 * Returns `null` when the input is not a valid public host name.
 */
export function normalizeDomain(input: string): string | null {
  let raw = input.trim().toLowerCase();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `http://${raw}`;

  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    return null;
  }

  host = host.replace(/\.$/, '');
  if (host.startsWith('www.')) host = host.slice(4);
  if (!host || host.length > 253) return null;
  // Reject IP literals: projects and competitors must be domains.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return null;

  const labels = host.split('.');
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;
  const tld = labels[labels.length - 1]!;
  if (/^\d+$/.test(tld)) return null;

  return host;
}

/** Heuristic used by the global search: does this input look like a domain or URL? */
export function looksLikeDomain(input: string): boolean {
  const s = input.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\//i.test(s)) return normalizeDomain(s) !== null;
  return /\.[\p{L}a-z]{2,}(\/.*)?$/iu.test(s) && normalizeDomain(s) !== null;
}

export const domainSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((v, ctx) => {
    const d = normalizeDomain(v);
    if (!d) {
      ctx.addIssue({ code: 'custom', message: 'Invalid domain' });
      return z.NEVER;
    }
    return d;
  });
