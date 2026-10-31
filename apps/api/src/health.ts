import { HealthResponseSchema, type HealthResponse } from '@rideloc/shared';

/** Builds the health payload and validates it against the shared schema. */
export function buildHealth(
  uptimeS: number = process.uptime(),
  dbUp: boolean = true,
): HealthResponse {
  return HealthResponseSchema.parse({ status: dbUp ? 'ok' : 'degraded', uptimeS });
}
