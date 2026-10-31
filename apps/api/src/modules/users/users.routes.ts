import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../../lib/errors';
import type { AuthService } from '../auth/auth.service';

export const userRoutes: FastifyPluginAsync<{ auth: AuthService }> = async (app, { auth }) => {
  app.get('/me', { preHandler: app.authenticate }, async (req) => {
    const user = await auth.getUserById(req.user.sub);
    // A valid token for a deleted user must not work.
    if (!user) throw new AppError(401, 'UNAUTHORIZED', 'User no longer exists');
    return { user };
  });
};
