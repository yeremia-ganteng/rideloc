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
});
