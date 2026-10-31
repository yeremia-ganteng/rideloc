import type { Generated } from 'kysely';
import type { Role, VehicleType } from '@rideloc/shared';

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

export interface Database {
  users: UsersTable;
  drivers: DriversTable;
  refresh_tokens: RefreshTokensTable;
}
