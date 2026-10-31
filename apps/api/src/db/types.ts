import type { Generated } from 'kysely';
import type { RideStatus, Role, VehicleType } from '@rideloc/shared';

export type OfferOutcome = 'ACCEPTED' | 'REJECTED' | 'TIMEOUT';

export interface UsersTable {
  id: Generated<string>;
  email: string;
  password_hash: string;
  full_name: string;
  phone: string | null;
  role: Role;
  created_at: Generated<Date>;
}

export interface DriversTable {
  user_id: string;
  vehicle_type: VehicleType;
  plate_number: string;
  rating_avg: Generated<string>; // numeric -> string in node-pg
  is_online: Generated<boolean>;
  // geography is read/written via raw SQL (ST_*), so we keep it opaque here.
  last_location: Generated<string | null>;
  last_seen_at: Generated<Date | null>;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  user_id: string;
  family_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Generated<Date | null>;
  created_at: Generated<Date>;
}

export interface RidesTable {
  id: Generated<string>;
  rider_id: string;
  driver_id: Generated<string | null>;
  status: RideStatus;
  vehicle_type: VehicleType;
  // geography columns are written with ST_* expressions and read with ST_X / ST_Y.
  pickup: string;
  pickup_address: string | null;
  dropoff: string;
  dropoff_address: string | null;
  distance_m: number;
  duration_s: number;
  fare_idr: number;
  route_polyline: string | null;
  cancel_reason: Generated<string | null>;
  requested_at: Generated<Date>;
  accepted_at: Generated<Date | null>;
  started_at: Generated<Date | null>;
  completed_at: Generated<Date | null>;
  cancelled_at: Generated<Date | null>;
}

export interface RideOffersTable {
  id: Generated<string>;
  ride_id: string;
  driver_id: string;
  /** NULL = pending. */
  outcome: Generated<OfferOutcome | null>;
  distance_m: number;
  offered_at: Generated<Date>;
  expires_at: Date;
  responded_at: Generated<Date | null>;
}

export interface Database {
  users: UsersTable;
  drivers: DriversTable;
  refresh_tokens: RefreshTokensTable;
  rides: RidesTable;
  ride_offers: RideOffersTable;
}
