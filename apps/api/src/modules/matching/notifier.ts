import type { OfferPayload, RideUpdatePayload } from '@rideloc/shared';

/** What matching needs from the realtime layer. Easy to fake in tests. */
export interface Notifier {
  offerNew(driverId: string, offer: OfferPayload): void;
  rideUpdated(riderId: string, update: RideUpdatePayload): void;
}
