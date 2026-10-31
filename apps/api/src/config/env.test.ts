import { DEFAULT_PRICING } from '@rideloc/shared';
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const base = {
  DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
  it('memakai default yang aman', () => {
    const env = loadEnv(base);
    expect(env.PORT).toBe(3000);
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.OSRM_TIMEOUT_MS).toBe(2000);
    expect(env.MAX_TRIP_KM).toBe(100);
    expect(env.PRICING).toEqual(DEFAULT_PRICING);
  });
  it('REDIS_URL punya default untuk dev dan menolak nilai bukan URL', () => {
    expect(loadEnv(base).REDIS_URL).toBe('redis://127.0.0.1:6379');
    expect(() => loadEnv({ ...base, REDIS_URL: 'bukan-url' })).toThrow(/REDIS_URL/);
  });

  it('memecah CORS_ORIGINS dan meng-coerce angka', () => {
    const env = loadEnv({ ...base, CORS_ORIGINS: 'https://a.com, https://b.com', PORT: '4000' });
    expect(env.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(env.PORT).toBe(4000);
  });

  it('menolak secret pendek tanpa membocorkan nilainya', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'tooshort' })).toThrow(/JWT_ACCESS_SECRET/);
    try {
      loadEnv({ ...base, JWT_ACCESS_SECRET: 'tooshort' });
    } catch (err) {
      expect(String(err)).not.toContain('tooshort');
    }
  });

  it('menolak DATABASE_URL yang hilang', () => {
    expect(() => loadEnv({ JWT_ACCESS_SECRET: 'x'.repeat(32) })).toThrow(/DATABASE_URL/);
  });

  it('PRICING_JSON valid menimpa default', () => {
    const custom = {
      ...DEFAULT_PRICING,
      MOTORCYCLE: { base: 1000, perKm: 3000, perMinute: 100, minimum: 7000 },
    };
    const env = loadEnv({ ...base, PRICING_JSON: JSON.stringify(custom) });
    expect(env.PRICING.MOTORCYCLE.perKm).toBe(3000);
  });

  it('PRICING_JSON rusak atau tidak valid ditolak dengan pesan yang menyebut nama variabel', () => {
    expect(() => loadEnv({ ...base, PRICING_JSON: '{oops' })).toThrow(/PRICING_JSON/);
    expect(() =>
      loadEnv({
        ...base,
        PRICING_JSON: JSON.stringify({
          ...DEFAULT_PRICING,
          CAR: { ...DEFAULT_PRICING.CAR, base: 1.5 },
        }),
      }),
    ).toThrow(/PRICING_JSON\.CAR\.base/);
  });

  it('menolak MAX_TRIP_KM di luar rentang', () => {
    expect(() => loadEnv({ ...base, MAX_TRIP_KM: '0' })).toThrow(/MAX_TRIP_KM/);
  });

  it('parameter matching punya default sesuai PRD dan menolak nilai di luar rentang', () => {
    const env = loadEnv(base);
    expect(env.MATCH_OFFER_TTL_S).toBe(15);
    expect(env.MATCH_SEARCH_TIMEOUT_S).toBe(30);
    expect(env.MATCH_TICK_MS).toBe(1000);
    expect(() => loadEnv({ ...base, MATCH_OFFER_TTL_S: '0' })).toThrow(/MATCH_OFFER_TTL_S/);
    expect(() => loadEnv({ ...base, MATCH_TICK_MS: '10' })).toThrow(/MATCH_TICK_MS/);
  });
});
