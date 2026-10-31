/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createType('ride_status', [
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
  pgm.createType('offer_outcome', ['ACCEPTED', 'REJECTED', 'TIMEOUT']);

  pgm.createTable('rides', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    rider_id: { type: 'uuid', notNull: true, references: 'users' },
    driver_id: { type: 'uuid', references: 'drivers' },
    status: { type: 'ride_status', notNull: true, default: 'REQUESTED' },
    vehicle_type: { type: 'vehicle_type', notNull: true },
    pickup: { type: 'geography(Point,4326)', notNull: true },
    pickup_address: { type: 'text' },
    dropoff: { type: 'geography(Point,4326)', notNull: true },
    dropoff_address: { type: 'text' },
    distance_m: { type: 'integer', notNull: true },
    duration_s: { type: 'integer', notNull: true },
    fare_idr: { type: 'integer', notNull: true },
    route_polyline: { type: 'text' },
    cancel_reason: { type: 'text' },
    requested_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    accepted_at: { type: 'timestamptz' },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
    cancelled_at: { type: 'timestamptz' },
  });

  pgm.addConstraint(
    'rides',
    'rides_amounts_chk',
    'CHECK (distance_m >= 0 AND duration_s >= 0 AND fare_idr >= 0)',
  );
  pgm.addConstraint(
    'rides',
    'rides_driver_not_rider_chk',
    'CHECK (driver_id IS NULL OR driver_id <> rider_id)',
  );
  // A ride that is assigned or beyond must have a driver.
  pgm.addConstraint(
    'rides',
    'rides_assigned_has_driver_chk',
    "CHECK (status NOT IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS','COMPLETED') OR driver_id IS NOT NULL)",
  );

  // History (PRD).
  pgm.sql('CREATE INDEX rides_rider_history_idx ON rides (rider_id, requested_at DESC)');
  pgm.sql('CREATE INDEX rides_driver_history_idx ON rides (driver_id, requested_at DESC)');

  // LAYER 3 of the double-assignment defense. KEEP IN SYNC with DRIVER_ACTIVE_STATUSES (shared).
  pgm.sql(`CREATE UNIQUE INDEX rides_one_active_per_driver_uq ON rides (driver_id)
    WHERE status IN ('DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`);

  // One active ride per rider (assumption). KEEP IN SYNC with RIDER_ACTIVE_STATUSES (shared).
  pgm.sql(`CREATE UNIQUE INDEX rides_one_active_per_rider_uq ON rides (rider_id)
    WHERE status IN ('REQUESTED','SEARCHING','DRIVER_ASSIGNED','DRIVER_ARRIVING','DRIVER_ARRIVED','IN_PROGRESS')`);

  // The matching tick scans only rides that are still searching.
  pgm.sql("CREATE INDEX rides_searching_idx ON rides (requested_at) WHERE status = 'SEARCHING'");

  pgm.createTable('ride_offers', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    ride_id: { type: 'uuid', notNull: true, references: 'rides', onDelete: 'CASCADE' },
    driver_id: { type: 'uuid', notNull: true, references: 'drivers', onDelete: 'CASCADE' },
    // NULL means "pending" (offered, no answer yet).
    outcome: { type: 'offer_outcome' },
    distance_m: { type: 'integer', notNull: true },
    offered_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    expires_at: { type: 'timestamptz', notNull: true },
    responded_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('ride_offers', 'ride_offers_distance_chk', 'CHECK (distance_m >= 0)');

  // A driver is offered a given ride at most once.
  pgm.sql('CREATE UNIQUE INDEX ride_offers_ride_driver_uq ON ride_offers (ride_id, driver_id)');
  // A ride has at most one pending offer at any time.
  pgm.sql(
    'CREATE UNIQUE INDEX ride_offers_one_pending_per_ride_uq ON ride_offers (ride_id) WHERE outcome IS NULL',
  );
  // The tick looks for pending offers that have expired.
  pgm.sql(
    'CREATE INDEX ride_offers_pending_expiry_idx ON ride_offers (expires_at) WHERE outcome IS NULL',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('ride_offers');
  pgm.dropTable('rides');
  pgm.dropType('offer_outcome');
  pgm.dropType('ride_status');
};
