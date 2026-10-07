import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION = 'v1';

function keyFrom(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (base64-encoded)');
  return key;
}

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Output: `v1.<iv>.<tag>.<ciphertext>` (base64url parts) — self-describing so the
 * format can be rotated later. `aad` binds the ciphertext to a context (e.g. org id).
 */
export function encryptSecret(plaintext: string, base64Key: string, aad?: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, keyFrom(base64Key), iv, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function decryptSecret(payload: string, base64Key: string, aad?: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || dataB64 === undefined) {
    throw new Error('Unsupported encrypted payload format');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    keyFrom(base64Key),
    Buffer.from(ivB64, 'base64url'),
    {
      authTagLength: TAG_LENGTH,
    },
  );
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
