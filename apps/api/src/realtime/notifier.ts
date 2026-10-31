import type { Notifier } from '../modules/matching/notifier';
import type { AppSocketServer } from './socket';

/** Rooms are `user:{id}`, joined only by the server (see socket.ts). */
export function createNotifier(io: AppSocketServer): Notifier {
  return {
    offerNew: (driverId, offer) => {
      io.to(`user:${driverId}`).emit('offer:new', offer);
    },
    rideUpdated: (riderId, update) => {
      io.to(`user:${riderId}`).emit('ride:updated', update);
    },
  };
}
