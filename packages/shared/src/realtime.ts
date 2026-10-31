import type { Role } from './auth';
import type { OfferAck, OfferPayload, RideUpdatePayload } from './matching';

export type LocationRejectReason =
  'LOW_ACCURACY' | 'NOT_ONLINE' | 'FORBIDDEN' | 'INVALID' | 'RATE_LIMITED' | 'INTERNAL';

export type LocationAck =
  { ok: true; availability: 'AVAILABLE' | 'BUSY' } | { ok: false; reason: LocationRejectReason };

export interface ClientToServerEvents {
  /** Payload is untrusted: the server validates it with DriverLocationSchema. */
  'driver:location': (payload: unknown, ack: (res: LocationAck) => void) => void;
  /** Payload is untrusted: the server validates it with OfferRespondSchema. */
  'offer:respond': (payload: unknown, ack: (res: OfferAck) => void) => void;
}

export interface ServerToClientEvents {
  /** Sent right before the server drops a connection whose access token expired. */
  'session:expired': () => void;
  'offer:new': (offer: OfferPayload) => void;
  'ride:updated': (update: RideUpdatePayload) => void;
}

/** Unused until the Redis adapter arrives in Phase 8. */
export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  role: Role;
  expiresAtMs: number;
}
