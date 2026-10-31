/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const up = (pgm) => {
  pgm.createExtension('postgis', { ifNotExists: true });

  pgm.createType('user_role', ['RIDER', 'DRIVER', 'ADMIN']);
  pgm.createType('vehicle_type', ['MOTORCYCLE', 'CAR']);

  pgm.createTable('users', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    email: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    full_name: { type: 'text', notNull: true },
    phone: { type: 'text' },
    role: { type: 'user_role', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // App normalizes to lowercase; the DB enforces it so uniqueness is case-insensitive.
  pgm.addConstraint('users', 'users_email_lowercase_chk', 'CHECK (email = lower(email))');

  pgm.createTable('drivers', {
    user_id: {
      type: 'uuid',
      primaryKey: true,
      references: 'users',
      onDelete: 'CASCADE',
    },
    vehicle_type: { type: 'vehicle_type', notNull: true },
    plate_number: { type: 'text', notNull: true },
    rating_avg: { type: 'numeric(3,2)', notNull: true, default: 0 },
    is_online: { type: 'boolean', notNull: true, default: false },
    last_location: { type: 'geography(Point,4326)' },
    last_seen_at: { type: 'timestamptz' },
  });
  pgm.addConstraint('drivers', 'drivers_rating_avg_chk', 'CHECK (rating_avg BETWEEN 0 AND 5)');
  pgm.createIndex('drivers', 'last_location', { method: 'gist' });

  pgm.createTable('refresh_tokens', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'CASCADE' },
    family_id: { type: 'uuid', notNull: true },
    token_hash: { type: 'text', notNull: true, unique: true },
    expires_at: { type: 'timestamptz', notNull: true },
    revoked_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('refresh_tokens', 'family_id');
  pgm.createIndex('refresh_tokens', 'user_id');
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
export const down = (pgm) => {
  pgm.dropTable('refresh_tokens');
  pgm.dropTable('drivers');
  pgm.dropTable('users');
  pgm.dropType('vehicle_type');
  pgm.dropType('user_role');
  // The postgis extension is intentionally NOT dropped: other objects may depend on it.
};
