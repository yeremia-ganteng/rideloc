import { describe, expect, it } from 'vitest';
import { getDummyHash, hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('menghasilkan hash argon2id dan memverifikasinya', async () => {
    const hashed = await hashPassword('correct-horse-9');
    expect(hashed.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hashed, 'correct-horse-9')).toBe(true);
    expect(await verifyPassword(hashed, 'wrong-password')).toBe(false);
  });

  it('hash berbeda untuk password yang sama (salt acak)', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('mengembalikan false untuk hash rusak, bukan melempar', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('dummy hash valid dan di-cache', async () => {
    expect(await getDummyHash()).toBe(await getDummyHash());
  });
});
