import type { LatLng } from '@rideloc/shared';
import { z } from 'zod';
import { RoutingError, type RouteResult, type RoutingClient } from './types';

const OsrmResponseSchema = z.object({
  code: z.string(),
  routes: z
    .array(
      z.object({
        distance: z.number().nonnegative(),
        duration: z.number().nonnegative(),
        geometry: z.string(),
      }),
    )
    .optional(),
});

export interface OsrmClientOptions {
  baseUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

export function createOsrmClient({
  baseUrl,
  timeoutMs,
  fetchImpl = fetch,
}: OsrmClientOptions): RoutingClient {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    async route(from: LatLng, to: LatLng): Promise<RouteResult> {
      // OSRM wants lng,lat (NOT lat,lng). toFixed avoids exponent notation like "1e-7".
      const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}`;
      const url = `${root}/route/v1/driving/${coords}?overview=simplified&geometries=polyline`;

      let res: Response;
      try {
        res = await fetchImpl(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json' },
        });
      } catch (cause) {
        throw new RoutingError('OSRM request failed or timed out', { cause });
      }
      if (!res.ok) throw new RoutingError(`OSRM responded with HTTP ${res.status}`);

      let body: unknown;
      try {
        body = await res.json();
      } catch (cause) {
        throw new RoutingError('OSRM returned invalid JSON', { cause });
      }

      const parsed = OsrmResponseSchema.safeParse(body);
      if (!parsed.success) throw new RoutingError('OSRM response has an unexpected shape');

      const first = parsed.data.routes?.[0];
      if (parsed.data.code !== 'Ok' || !first) {
        throw new RoutingError(`OSRM could not route (code ${parsed.data.code})`);
      }

      return {
        distanceM: Math.round(first.distance),
        durationS: Math.round(first.duration),
        polyline: first.geometry,
      };
    },
  };
}
