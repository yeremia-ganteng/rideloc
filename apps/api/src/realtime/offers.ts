import { OfferRespondSchema, type OfferAck } from '@rideloc/shared';
import type { MinimalLogger } from '../lib/logger';
import type { MatchingService } from '../modules/matching/matching.service';
import type { AppSocketServer } from './socket';

const WINDOW_MS = 10_000;
const MAX_PER_WINDOW = 20;

/** Adds the `offer:respond` handler. Identity and expiry come from the verified socket data. */
export function registerOfferHandlers({
  io,
  matching,
  logger,
}: {
  io: AppSocketServer;
  matching: MatchingService;
  logger: MinimalLogger;
}): void {
  io.on('connection', (socket) => {
    const { userId, role, expiresAtMs } = socket.data;

    let windowStart = Date.now();
    let inWindow = 0;
    const withinRateLimit = (): boolean => {
      const now = Date.now();
      if (now - windowStart >= WINDOW_MS) {
        windowStart = now;
        inWindow = 0;
      }
      inWindow += 1;
      return inWindow <= MAX_PER_WINDOW;
    };

    async function handle(payload: unknown): Promise<OfferAck> {
      if (!withinRateLimit()) return { ok: false, reason: 'RATE_LIMITED' };
      if (role !== 'DRIVER' || Date.now() >= expiresAtMs) return { ok: false, reason: 'FORBIDDEN' };

      const parsed = OfferRespondSchema.safeParse(payload);
      if (!parsed.success) return { ok: false, reason: 'INVALID' };

      try {
        // The driver id comes from the verified token, NEVER from the payload.
        return await matching.respond(userId, parsed.data.rideId, parsed.data.accept);
      } catch (err) {
        logger.error({ err }, 'offer:respond failed');
        return { ok: false, reason: 'INTERNAL' };
      }
    }

    socket.on('offer:respond', (payload, ack) => {
      void handle(payload).then((res) => {
        if (typeof ack === 'function') ack(res);
      });
    });
  });
}
