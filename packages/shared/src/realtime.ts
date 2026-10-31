import type { Role } from './auth';

export type LocationRejectReason =
  'LOW_ACCURACY' | 'NOT_ONLINE' | 'FORBIDDEN' | 'INVALID' | 'RATE_LIMITED' | 'INTERNAL';

export type LocationAck =
  { ok: true; availability: 'AVAILABLE' | 'BUSY' } | { ok: false; reason: LocationRejectReason };

export interface ClientToServerEvents {
  /** Payload is untrusted: the server validates it with DriverLocationSchema. */
  'driver:location': (payload: unknown, ack: (res: LocationAck) => void) => void;
}

export interface ServerToClientEvents {
  /** Sent right before the server drops a connection whose access token expired. */
  'session:expired': () => void;
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
