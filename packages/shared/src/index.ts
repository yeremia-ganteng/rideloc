import { z } from 'zod';

export const APP_NAME = 'RideLoc' as const;

export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  uptimeS: z.number().nonnegative(),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;
