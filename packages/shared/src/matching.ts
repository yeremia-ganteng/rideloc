import { z } from 'zod';
import type { RideStatus } from './ride-state';
import type { LatLng } from './rides';

/** FR-2: at most 5 offers per ride. */
export const MAX_OFFER_ATTEMPTS = 5;
/** FR-2: search radii in meters, tried in this order. */
export const SEARCH_RADII_M = [3000, 5000, 8000] as const;

export const OfferRespondSchema = z.object({
  rideId: z.string().uuid(),
  accept: z.boolean(),
});
export type OfferRespond = z.infer<typeof OfferRespondSchema>;

/** Sent to ONE driver. Deliberately contains no rider identity. */
export interface OfferPayload {
  rideId: string;
  pickup: LatLng;
  dropoff: LatLng;
  fareIdr: number;
  /** Trip distance. */
  distanceM: number;
  /** Distance from the driver to the pickup point. */
  pickupDistanceM: number;
  expiresAt: string;
}

export type OfferRejectReason =
  | 'FORBIDDEN'
  | 'INVALID'
  | 'RATE_LIMITED'
  | 'OFFER_NOT_FOUND'
  | 'OFFER_EXPIRED'
  | 'DRIVER_OFFLINE'
  | 'DRIVER_BUSY'
  | 'RIDE_UNAVAILABLE'
  | 'INTERNAL';

export type OfferAck = { ok: true; accepted: boolean } | { ok: false; reason: OfferRejectReason };

/** Minimal on purpose. Driver details for the rider come in Phase 5. */
export interface RideUpdatePayload {
  rideId: string;
  status: RideStatus;
}
