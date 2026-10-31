import { z } from 'zod';

export * from './auth';
export * from './location';
export * from './matching';
export * from './pricing';
export * from './realtime';
export * from './ride-state';
export * from './rides';

export const APP_NAME = 'RideLoc' as const;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeS: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
