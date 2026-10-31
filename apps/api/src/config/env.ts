import { DEFAULT_PRICING, PricingConfigSchema, type PricingConfig } from '@rideloc/shared';
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(100),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
  // --- Fase 2 ---
  OSRM_BASE_URL: z.string().url().default('https://router.project-osrm.org'),
  OSRM_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2000),
  MAX_TRIP_KM: z.coerce.number().min(1).max(500).default(100),
  ESTIMATE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
  PRICING_JSON: z.string().optional(),
  REDIS_URL: z.string().url().default('redis://127.0.0.1:6379'),
  // --- Fase 4 ---
  MATCH_OFFER_TTL_S: z.coerce.number().int().min(1).max(120).default(15),
  MATCH_SEARCH_TIMEOUT_S: z.coerce.number().int().min(0).max(300).default(30),
  MATCH_TICK_MS: z.coerce.number().int().min(200).max(10_000).default(1000),
});

export type Env = Omit<z.infer<typeof EnvSchema>, 'PRICING_JSON'> & { PRICING: PricingConfig };

function parsePricing(raw: string | undefined): PricingConfig {
  if (raw === undefined || raw.trim() === '') return DEFAULT_PRICING;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('Invalid environment configuration:\n  - PRICING_JSON: must be valid JSON');
  }
  const result = PricingConfigSchema.safeParse(json);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - PRICING_JSON.${i.path.map(String).join('.')}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Validates env vars. The error lists variable names + reasons, never their values. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map(
      (i) => `  - ${i.path.map(String).join('.')}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const { PRICING_JSON, ...rest } = result.data;
  return { ...rest, PRICING: parsePricing(PRICING_JSON) };
}
