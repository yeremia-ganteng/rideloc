import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import type {
  LatLng,
  OfferAck,
  OfferPayload,
  RideStatus,
  RideUpdatePayload,
} from '@rideloc/shared';
import type { Database } from '../src/db/types';
import type { ClientSocket } from './socket-helpers';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Roughly 1 degree of latitude. Good enough to place drivers at ~N meters from a point. */
export function offsetNorth(base: LatLng, meters: number): LatLng {
  return { lat: base.lat + meters / 111_195, lng: base.lng };
}

function createInbox<T>() {
  const received: T[] = [];
  const waiters: Array<(value: T) => void> = [];
  return {
    /** Events that arrived and nobody waited for. Handy for "nothing was delivered" assertions. */
    received,
    push(value: T): void {
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else received.push(value);
    },
    next(ms = 3000): Promise<T> {
      const ready = received.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise<T>((resolve, reject) => {
        const waiter = (value: T): void => {
          clearTimeout(timer);
          resolve(value);
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('timed out waiting for an event'));
        }, ms);
        waiters.push(waiter);
      });
    },
  };
}

export function trackOffers(socket: ClientSocket) {
  const inbox = createInbox<OfferPayload>();
  socket.on('offer:new', (offer) => inbox.push(offer));
  return inbox;
}

export function trackRideUpdates(socket: ClientSocket) {
  const inbox = createInbox<RideUpdatePayload>();
  socket.on('ride:updated', (update) => inbox.push(update));
  return inbox;
}

export function respondOffer(socket: ClientSocket, payload: unknown): Promise<OfferAck> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 3000);
    socket.emit('offer:respond', payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

export function requestRide(app: FastifyInstance, token: string, body: object) {
  return app.inject({
    method: 'POST',
    url: '/rides',
    payload: body,
    headers: { authorization: `Bearer ${token}` },
  });
}

/** Inserts a ride directly, bypassing the API. Used to build exact race scenarios. */
export async function insertRide(
  db: Kysely<Database>,
  o: { riderId: string; status: RideStatus; driverId?: string | null },
): Promise<string> {
  const res = await sql<{ id: string }>`
    insert into rides (rider_id, driver_id, status, vehicle_type, pickup, dropoff, distance_m, duration_s, fare_idr)
    values (${o.riderId}, ${o.driverId ?? null}, ${o.status}::ride_status, 'MOTORCYCLE',
      ST_SetSRID(ST_MakePoint(106.8272, -6.1751), 4326)::geography,
      ST_SetSRID(ST_MakePoint(106.8456, -6.2088), 4326)::geography,
      5000, 900, 17500)
    returning id`.execute(db);
  const row = res.rows[0];
  if (!row) throw new Error('insertRide returned no row');
  return row.id;
}

/** Inserts a pending offer directly (bypassing the offer lock). A negative ttl means already expired. */
export async function insertOffer(
  db: Kysely<Database>,
  o: { rideId: string; driverId: string; ttlS: number },
): Promise<void> {
  await sql`
    insert into ride_offers (ride_id, driver_id, distance_m, expires_at)
    values (${o.rideId}, ${o.driverId}, 100, now() + ${o.ttlS}::int * interval '1 second')`.execute(
    db,
  );
}
