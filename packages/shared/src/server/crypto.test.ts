import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

const key = randomBytes(32).toString('base64');

describe('AES-256-GCM secrets', () => {
  it('round-trips unicode', () => {
    const secret = 'ya29.токен-🔐';
    const enc = encryptSecret(secret, key);
    expect(enc.startsWith('v1.')).toBe(true);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, key)).toBe(secret);
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('x', key)).not.toBe(encryptSecret('x', key));
  });

  it('fails with the wrong key, tampered data or wrong AAD', () => {
    const enc = encryptSecret('secret', key, 'org_1');
    expect(() => decryptSecret(enc, randomBytes(32).toString('base64'), 'org_1')).toThrow();
    expect(() => decryptSecret(enc, key, 'org_2')).toThrow();
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key, 'org_1')).toThrow();
    expect(decryptSecret(enc, key, 'org_1')).toBe('secret');
  });

  it('rejects keys of the wrong length', () => {
    expect(() => encryptSecret('x', Buffer.from('short').toString('base64'))).toThrow(/32 bytes/);
  });
});
