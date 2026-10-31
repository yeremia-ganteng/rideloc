export interface GeoCandidate {
  driverId: string;
  distanceM: number;
}

/**
 * Parses the reply of: GEOSEARCH ... ASC COUNT n WITHDIST  =>  [[member, "distance"], ...].
 * Anything malformed is skipped instead of crashing the matching loop.
 */
export function parseGeoSearchWithDist(raw: unknown): GeoCandidate[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoCandidate[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    const [member, dist] = entry as unknown[];
    if (typeof member !== 'string') continue;
    const meters = Number(dist);
    if (!Number.isFinite(meters) || meters < 0) continue;
    out.push({ driverId: member, distanceM: Math.round(meters) });
  }
  return out;
}
