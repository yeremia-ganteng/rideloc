import { describe, expect, it } from 'vitest';
import { buildHealth } from './health';

describe('buildHealth', () => {
  it('mengembalikan status ok dengan uptime yang diberikan', () => {
    expect(buildHealth(12.5)).toEqual({ status: 'ok', uptimeS: 12.5 });
  });

  it('melempar error jika uptime negatif', () => {
    expect(() => buildHealth(-1)).toThrow();
  });
});
