export const REDIS_KEYS = {
  /** GEO set of online drivers that have a fresh location. */
  geo: 'drivers:geo',
  online: (driverId: string) => `driver:${driverId}:online`,
  heartbeat: (driverId: string) => `driver:${driverId}:hb`,
  /** Written by matching (Phase 4): the driver currently has a ride. */
  busy: (driverId: string) => `driver:${driverId}:busy`,
  persistThrottle: (driverId: string) => `driver:${driverId}:persist`,
  sweeperLock: 'lock:ghost-sweeper',
} as const;

export const PRESENCE = {
  HEARTBEAT_TTL_S: 15,
  ONLINE_TTL_S: 120,
  PERSIST_INTERVAL_S: 30,
  SWEEP_INTERVAL_MS: 5000,
} as const;
