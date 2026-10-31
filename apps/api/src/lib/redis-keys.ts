export const REDIS_KEYS = {
  /** GEO set of online drivers that have a fresh location. */
  geo: 'drivers:geo',
  online: (driverId: string) => `driver:${driverId}:online`,
  heartbeat: (driverId: string) => `driver:${driverId}:hb`,
  /** Value = id of the ride the driver is serving. Written when an offer is accepted. */
  busy: (driverId: string) => `driver:${driverId}:busy`,
  /** Value = id of the ride currently offered to the driver. One pending offer per driver. */
  offerLock: (driverId: string) => `driver:${driverId}:lock`,
  persistThrottle: (driverId: string) => `driver:${driverId}:persist`,
  sweeperLock: 'lock:ghost-sweeper',
  matchingLock: 'lock:matching-tick',
} as const;

export const PRESENCE = {
  HEARTBEAT_TTL_S: 15,
  ONLINE_TTL_S: 120,
  PERSIST_INTERVAL_S: 30,
  SWEEP_INTERVAL_MS: 5000,
} as const;

export const MATCHING = {
  /** Safety net only: Phase 5 deletes the busy key when a ride ends. */
  BUSY_TTL_S: 4 * 3600,
  /** The offer lock outlives the offer a little, so it never expires before the offer does. */
  OFFER_LOCK_GRACE_S: 10,
  CANDIDATES_PER_SCAN: 30,
} as const;
