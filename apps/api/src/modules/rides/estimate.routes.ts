import type { FastifyPluginAsync } from 'fastify';
import { EstimateRequestSchema, type EstimateResponse } from '@rideloc/shared';
import type { Env } from '../../config/env';
import { parseOrThrow } from '../../lib/errors';
import { requireRole } from '../../plugins/authorize';
import type { EstimateService } from './estimate.service';

interface Options {
  estimate: EstimateService;
  env: Env;
}

export const estimateRoutes: FastifyPluginAsync<Options> = async (app, { estimate, env }) => {
  app.post(
    '/rides/estimate',
    {
      preHandler: [app.authenticate, requireRole('RIDER')],
      // Per-IP (the limiter runs before auth). Each call may hit the external routing service.
      config: { rateLimit: { max: env.ESTIMATE_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    },
    async (req): Promise<EstimateResponse> => {
      const input = parseOrThrow(EstimateRequestSchema, req.body);
      return { estimate: await estimate.estimate(input) };
    },
  );
};
