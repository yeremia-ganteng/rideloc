import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { z } from 'zod';
import {
  DriverLocationSchema,
  RoleSchema,
  type ClientToServerEvents,
  type InterServerEvents,
  type LocationAck,
  type ServerToClientEvents,
  type SocketData,
} from '@rideloc/shared';
import type { Env } from '../config/env';
import type { PresenceService } from '../modules/drivers/presence.service';

export type AppSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

/** Same token as REST, but we never trust its shape: validate the decoded payload too. */
const TokenPayloadSchema = z.object({
  sub: z.string().uuid(),
  role: RoleSchema,
  exp: z.number(),
});

/** Per-connection limit. A driver sends every 3-5 s, so 10 per 10 s leaves generous headroom. */
const LOCATION_WINDOW_MS = 10_000;
const LOCATION_MAX_PER_WINDOW = 10;
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface RealtimeDeps {
  app: FastifyInstance;
  env: Env;
  presence: PresenceService;
}

export function createRealtime({ app, env, presence }: RealtimeDeps): AppSocketServer {
  const io: AppSocketServer = new Server(app.server, {
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    serveClient: false,
    maxHttpBufferSize: 10_000, // location payloads are tiny; reject anything larger
  });

  // RISKY (security): authentication. The token travels in handshake.auth, never in the URL.
  io.use((socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
      return next(new Error('UNAUTHORIZED'));
    }
    try {
      const payload = TokenPayloadSchema.parse(app.jwt.verify(token));
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      socket.data.expiresAtMs = payload.exp * 1000;
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED')); // same message for every failure cause
    }
  });

  io.on('connection', (socket) => {
    const { userId, role, expiresAtMs } = socket.data;

    // The only room a client joins, and only the server decides which one.
    void socket.join(`user:${userId}`);

    // The connection must not outlive its access token. The client refreshes and reconnects.
    const expiryTimer = setTimeout(
      () => {
        socket.emit('session:expired');
        socket.disconnect(true);
      },
      Math.min(Math.max(0, expiresAtMs - Date.now()), MAX_TIMER_MS),
    );
    expiryTimer.unref();
    socket.on('disconnect', () => clearTimeout(expiryTimer));

    let windowStart = Date.now();
    let inWindow = 0;
    const withinRateLimit = (): boolean => {
      const now = Date.now();
      if (now - windowStart >= LOCATION_WINDOW_MS) {
        windowStart = now;
        inWindow = 0;
      }
      inWindow += 1;
      return inWindow <= LOCATION_MAX_PER_WINDOW;
    };

    async function handleLocation(payload: unknown): Promise<LocationAck> {
      if (!withinRateLimit()) return { ok: false, reason: 'RATE_LIMITED' };
      if (role !== 'DRIVER' || Date.now() >= expiresAtMs) return { ok: false, reason: 'FORBIDDEN' };

      const parsed = DriverLocationSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: 'INVALID' };

      try {
        // userId comes from the verified token, NEVER from the payload.
        return await presence.updateLocation(userId, parsed.data);
      } catch (err) {
        // PRIVACY: log the error only, never the coordinates.
        app.log.error({ err }, 'driver:location failed');
        return { ok: false, reason: 'INTERNAL' };
      }
    }

    socket.on('driver:location', (payload, ack) => {
      void handleLocation(payload).then((res) => {
        if (typeof ack === 'function') ack(res);
      });
    });
  });

  // Same pattern as the fastify-socket.io plugin: drop sockets first, then close the engine.
  app.addHook('preClose', async () => {
    io.local.disconnectSockets(true);
  });
  app.addHook('onClose', async () => {
    await io.close();
  });

  return io;
}
