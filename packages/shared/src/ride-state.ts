import { z } from 'zod';
import { VehicleTypeSchema } from './auth';
import { EstimateRequestSchema, LatLngSchema } from './rides';

export const RideStatusSchema = z.enum([
  'REQUESTED',
  'SEARCHING',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER_FOUND',
]);
export type RideStatus = z.infer<typeof RideStatusSchema>;

/** FR-1. Every status change must be allowed by this table. */
export const RIDE_TRANSITIONS: Readonly<Record<RideStatus, readonly RideStatus[]>> = {
  REQUESTED: ['SEARCHING'],
  SEARCHING: ['DRIVER_ASSIGNED', 'NO_DRIVER_FOUND', 'CANCELLED'],
  DRIVER_ASSIGNED: ['DRIVER_ARRIVING', 'CANCELLED'],
  DRIVER_ARRIVING: ['DRIVER_ARRIVED', 'CANCELLED'],
  DRIVER_ARRIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_DRIVER_FOUND: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return RIDE_TRANSITIONS[from].includes(to);
}

/**
 * A driver with a ride in one of these statuses is busy.
 * KEEP IN SYNC with the partial unique index in the migration (an integration test checks it).
 */
export const DRIVER_ACTIVE_STATUSES: readonly RideStatus[] = [
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
];

/** A rider may have only one ride in one of these statuses. Also mirrored by a partial index. */
export const RIDER_ACTIVE_STATUSES: readonly RideStatus[] = [
  'REQUESTED',
  'SEARCHING',
  ...DRIVER_ACTIVE_STATUSES,
];

const AddressSchema = z.string().trim().min(1).max(200);

/** Unknown fields (fareIdr, status, driverId, ...) are stripped by Zod: the server decides them. */
export const CreateRideRequestSchema = EstimateRequestSchema.extend({
  pickupAddress: AddressSchema.optional(),
  dropoffAddress: AddressSchema.optional(),
});
export type CreateRideRequest = z.infer<typeof CreateRideRequestSchema>;

export const RideDtoSchema = z.object({
  id: z.string().uuid(),
  status: RideStatusSchema,
  vehicleType: VehicleTypeSchema,
  pickup: LatLngSchema,
  dropoff: LatLngSchema,
  pickupAddress: z.string().nullable(),
  dropoffAddress: z.string().nullable(),
  distanceM: z.number().int().nonnegative(),
  durationS: z.number().int().nonnegative(),
  fareIdr: z.number().int().nonnegative(),
  polyline: z.string().nullable(),
  requestedAt: z.string(),
});
export type RideDto = z.infer<typeof RideDtoSchema>;

export const CreateRideResponseSchema = z.object({ ride: RideDtoSchema });
export type CreateRideResponse = z.infer<typeof CreateRideResponseSchema>;
