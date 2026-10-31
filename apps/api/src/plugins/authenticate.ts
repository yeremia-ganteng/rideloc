import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Role } from '@rideloc/shared';
import { AppError } from '../lib/errors';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role; iat: number; exp: number };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
}

export function registerAuthenticate(app: FastifyInstance): void {
  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch {
      // Same response for missing / malformed / expired: do not leak which one it was.
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid or missing access token');
    }
  });
}
