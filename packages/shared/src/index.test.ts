import { describe, expect, it } from 'vitest';
import { HealthResponseSchema } from './index';

describe('HealthResponseSchema', () => {
  it('menerima payload valid', () => {
    expect(HealthResponseSchema.parse({ status: 'ok', uptimeS: 1.5 })).toEqual({
      status: 'ok',
      uptimeS: 1.5,
    });
  });

  it('menolak status tak dikenal', () => {
    expect(HealthResponseSchema.safeParse({ status: 'meh', uptimeS: 1 }).success).toBe(false);
  });

  it('menolak uptime negatif', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok', uptimeS: -1 }).success).toBe(false);
  });
});
