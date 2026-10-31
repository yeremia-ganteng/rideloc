import { hash, verify } from '@node-rs/argon2';

// OWASP-recommended minimum for Argon2id: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false; // malformed hash must never crash a login
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Hash used when the email does not exist, so login takes about the same time either way
 * (mitigates user enumeration via timing).
 */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalization');
  return dummyHash;
}
