import { DEFAULT_PRICING, type EstimateRequest } from '@rideloc/shared';
import { describe, expect, it, vi } from 'vitest';
import { RoutingError, type RouteResult } from '../routing/types';
import { createEstimateService } from './estimate.service';

const request: EstimateRequest = {
  pickup: { lat: -6.1751, lng: 106.8272 },
  dropoff: { lat: -6.2088, lng: 106.8456 },
  vehicleType: 'MOTORCYCLE',
};

function setup(route: () => Promise<RouteResult>) {
  const routing = { route: vi.fn(route) };
  const logger = { warn: vi.fn() };
  const service = createEstimateService({
    routing,
    pricing: DEFAULT_PRICING,
    maxTripKm: 100,
    logger,
  });
  return { routing, logger, service };
}

describe('estimate service', () => {
  it('memakai hasil OSRM dan menghitung tarif', async () => {
    const { service, logger } = setup(async () => ({
      distanceM: 5000,
      durationS: 900,
      polyline: 'abc',
    }));
    const result = await service.estimate(request);
    expect(result).toMatchObject({ fareIdr: 17_500, source: 'osrm', polyline: 'abc' });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('jatuh ke fallback saat routing gagal, dan mencatat peringatan', async () => {
    const { service, logger } = setup(async () => {
      throw new RoutingError('down');
    });
    const result = await service.estimate(request);
    expect(result.source).toBe('fallback');
    expect(result.polyline).toBeNull();
    expect(result.fareIdr % 500).toBe(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it('menolak perjalanan terlalu jauh TANPA memanggil routing', async () => {
    const { service, routing } = setup(async () => ({
      distanceM: 1,
      durationS: 1,
      polyline: null,
    }));
    await expect(
      service.estimate({ ...request, dropoff: { lat: -7.2575, lng: 112.7521 } }), // Surabaya
    ).rejects.toMatchObject({ statusCode: 422, code: 'TRIP_TOO_LONG' });
    expect(routing.route).not.toHaveBeenCalled();
  });
});
