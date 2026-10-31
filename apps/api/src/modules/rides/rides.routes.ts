import type { FastifyPluginAsync } from 'fastify';
import { CreateRideRequestSchema, type CreateRideResponse } from '@rideloc/shared';
import type { Env } from '../../config/env';
import { parseOrThrow } from '../../lib/errors';
import { requireRole } from '../../plugins/authorize';
import type { RidesService } from './rides.service';

interface Options {
  rides: RidesService;
  env: Env;
}

export const rideRoutes: FastifyPluginAsync<Options> = async (app, { rides, env }) => {
  app.post(
    '/rides',
    {
      preHandler: [app.authenticate, requireRole('RIDER')],
      // Same per-IP budget as estimates: both can reach the external routing service.
      config: { rateLimit: { max: env.ESTIMATE_RATE_LIMIT_MAX, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const input = parseOrThrow(CreateRideRequestSchema, req.body);
      const ride = await rides.create(req.user.sub, input);
      const body: CreateRideResponse = { ride };
      return reply.status(201).send(body);
    },
  );
};
