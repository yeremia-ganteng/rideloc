import type { FastifyRequest } from 'fastify';
import type { Role } from '@rideloc/shared';
import { AppError } from '../lib/errors';

/** preHandler. Must run AFTER app.authenticate because it reads request.user. */
export function requireRole(...roles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    if (!roles.includes(request.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have access to this resource');
    }
  };
}
