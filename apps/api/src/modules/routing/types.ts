import type { LatLng } from '@rideloc/shared';

export interface RouteResult {
  /** Whole meters. */
  distanceM: number;
  /** Whole seconds. */
  durationS: number;
  /** Encoded polyline (precision 5) or null if unavailable. */
  polyline: string | null;
}

export interface RoutingClient {
  route(from: LatLng, to: LatLng): Promise<RouteResult>;
}

export class RoutingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RoutingError';
  }
}
