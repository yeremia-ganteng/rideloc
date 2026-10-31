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
import type { Kysely } from 'kysely';
import type { Env } from './config/env';
import type { Database } from './db/types';
import { AppError } from './lib/errors';
import { authRoutes } from './modules/auth/auth.routes';
import { createAuthService } from './modules/auth/auth.service';
import { healthRoutes } from './modules/health/health.routes';
import { userRoutes } from './modules/users/users.routes';
import { registerAuthenticate } from './plugins/authenticate';

export interface AppDeps {
  env: Env;
  db: Kysely<Database>;
}

function loggerOptions(env: Env): FastifyServerOptions['logger'] {
  return {
    level: env.LOG_LEVEL,
    // Defense in depth: never log credentials, even if a serializer changes later.
    redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  };
}

export async function buildApp({ env, db }: AppDeps): Promise<FastifyInstance> {
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

  await app.register(healthRoutes, { db });
  await app.register(authRoutes, { prefix: '/auth', auth, env });
  await app.register(userRoutes, { auth });

  return app;
}
