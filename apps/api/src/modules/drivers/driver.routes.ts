import type { FastifyPluginAsync } from 'fastify';
import { requireRole } from '../../plugins/authorize';
import type { PresenceService } from './presence.service';

export const driverRoutes: FastifyPluginAsync<{ presence: PresenceService }> = async (
  app,
  { presence },
) => {
  const guard = [app.authenticate, requireRole('DRIVER')];

  app.post('/driver/online', { preHandler: guard }, async (req, reply) => {
    await presence.goOnline(req.user.sub);
    return reply.status(204).send();
  });

  app.post('/driver/offline', { preHandler: guard }, async (req, reply) => {
    await presence.goOffline(req.user.sub);
    return reply.status(204).send();
  });
};
