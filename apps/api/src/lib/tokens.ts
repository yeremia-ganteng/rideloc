import { createHash, randomBytes } from 'node:crypto';

/** 256-bit opaque token. High entropy, so a fast hash (SHA-256) is sufficient at rest. */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
