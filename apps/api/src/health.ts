import { HealthResponseSchema, type HealthResponse } from '@rideloc/shared';

/** Membangun payload health dan memvalidasinya lewat skema bersama. */
export function buildHealth(uptimeS: number = process.uptime()): HealthResponse {
  return HealthResponseSchema.parse({ status: 'ok', uptimeS });
}
