import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyServerOptions,
} from 'fastify';
import type { Redis } from 'ioredis';
import type { Kysely } from 'kysely';
import type { Env } from './config/env';
import type { Database } from './db/types';
import { AppError } from './lib/errors';
import { authRoutes } from './modules/auth/auth.routes';
import { createAuthService } from './modules/auth/auth.service';
import { driverRoutes } from './modules/drivers/driver.routes';
import { createPresenceService, type PresenceService } from './modules/drivers/presence.service';
import { healthRoutes } from './modules/health/health.routes';
import { createMatchingService, type MatchingService } from './modules/matching/matching.service';
import { estimateRoutes } from './modules/rides/estimate.routes';
import { createEstimateService } from './modules/rides/estimate.service';
import { rideRoutes } from './modules/rides/rides.routes';
import { createRidesService } from './modules/rides/rides.service';
import { createOsrmClient } from './modules/routing/osrm.client';
import type { RoutingClient } from './modules/routing/types';
import { userRoutes } from './modules/users/users.routes';
import { registerAuthenticate } from './plugins/authenticate';
import { createNotifier } from './realtime/notifier';
import { registerOfferHandlers } from './realtime/offers';
import { createRealtime } from './realtime/socket';

declare module 'fastify' {
  interface FastifyInstance {
    presence: PresenceService;
    matching: MatchingService;
  }
}

export interface AppDeps {
  env: Env;
  db: Kysely<Database>;
  redis: Redis;
  /** Override for tests. Defaults to the OSRM client configured by env. */
  routing?: RoutingClient;
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    // Defense in depth: never log credentials, even if a serializer changes later.
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

export async function buildApp({
  env,
  db,
  redis,
  routing: routingOverride,
}: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: loggerOptions(env), bodyLimit: 100_000 });

  await app.register(helmet);
  await app.register(cors, {
    origin: env.CORS_ORIGINS, // strict allowlist, never "*" with credentials
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: env.RATE_LIMIT_MAX, timeWindow: '1 minute' });
  await app.register(jwt, {
    secret: env.JWT_ACCESS_SECRET,
    sign: { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL },
    verify: { algorithms: ['HS256'] }, // pin the algorithm: blocks algorithm-confusion attacks
  });

  registerAuthenticate(app);

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    // Fastify's own 4xx errors (bad JSON, payload too large, rate limit, ...).
    if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code ?? 'BAD_REQUEST', message: error.message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply
      .status(500)
      .send({ error: { code: 'INTERNAL', message: 'Internal server error' } });
  });

  app.setNotFoundHandler((_req, reply) => {
    return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  const auth = createAuthService({ db, env, signAccessToken: (payload) => app.jwt.sign(payload) });

  const routing =
    routingOverride ??
    createOsrmClient({ baseUrl: env.OSRM_BASE_URL, timeoutMs: env.OSRM_TIMEOUT_MS });
  const estimate = createEstimateService({
    routing,
    pricing: env.PRICING,
    maxTripKm: env.MAX_TRIP_KM,
    logger: app.log,
  });

  const presence = createPresenceService({ redis, db, logger: app.log });
  app.decorate('presence', presence);

  const io = createRealtime({ app, env, presence });
  const matching = createMatchingService({
    db,
    redis,
    notifier: createNotifier(io),
    logger: app.log,
    offerTtlS: env.MATCH_OFFER_TTL_S,
    searchTimeoutS: env.MATCH_SEARCH_TIMEOUT_S,
  });
  app.decorate('matching', matching);
  registerOfferHandlers({ io, matching, logger: app.log });

  const rides = createRidesService({ db, estimate, matching, logger: app.log });

  await app.register(healthRoutes, { db, redis });
  await app.register(authRoutes, { prefix: '/auth', auth, env });
  await app.register(userRoutes, { auth });
  await app.register(estimateRoutes, { estimate, env });
  await app.register(rideRoutes, { rides, env });
  await app.register(driverRoutes, { presence });

  return app;
}
