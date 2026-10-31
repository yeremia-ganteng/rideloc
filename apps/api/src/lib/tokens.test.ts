import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from './tokens';

describe('refresh tokens', () => {
  it('menghasilkan token unik dengan panjang memadai', () => {
    const a = generateRefreshToken();
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).not.toBe(generateRefreshToken());
  });

  it('hash deterministik, hex 64 karakter, dan berbeda dari token', () => {
    const t = generateRefreshToken();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(t)).not.toBe(t);
  });
});
