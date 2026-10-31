import { describe, expect, it, vi } from 'vitest';
import { createOsrmClient } from './osrm.client';
import { RoutingError } from './types';

const from = { lat: -6.1751, lng: 106.8272 };
const to = { lat: -6.2088, lng: 106.8456 };
const okBody = {
  code: 'Ok',
  routes: [{ distance: 4321.6, duration: 600.4, geometry: '_p~iF~ps|U' }],
};

function mockFetch(status: number, body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

function clientWith(fetchMock: ReturnType<typeof mockFetch>) {
  return createOsrmClient({
    baseUrl: 'http://osrm.test/',
    timeoutMs: 500,
    fetchImpl: fetchMock as unknown as typeof fetch,
  });
}

describe('createOsrmClient', () => {
  it('membulatkan jarak/durasi dan meneruskan polyline', async () => {
    const result = await clientWith(mockFetch(200, okBody)).route(from, to);
    expect(result).toEqual({ distanceM: 4322, durationS: 600, polyline: '_p~iF~ps|U' });
  });

  it('memakai urutan lng,lat, 6 desimal, dan menyertakan timeout signal', async () => {
    const fetchMock = mockFetch(200, okBody);
    await clientWith(fetchMock).route(from, to);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://osrm.test/route/v1/driving/106.827200,-6.175100;106.845600,-6.208800?overview=simplified&geometries=polyline',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeDefined();
  });

  it('melempar RoutingError untuk HTTP non-200', async () => {
    await expect(clientWith(mockFetch(500, {})).route(from, to)).rejects.toBeInstanceOf(
      RoutingError,
    );
  });

  it('melempar RoutingError jika OSRM menjawab NoRoute', async () => {
    const c = clientWith(mockFetch(200, { code: 'NoRoute', message: 'nope' }));
    await expect(c.route(from, to)).rejects.toBeInstanceOf(RoutingError);
  });

  it('melempar RoutingError untuk JSON rusak atau bentuk tak terduga', async () => {
    await expect(clientWith(mockFetch(200, 'not json')).route(from, to)).rejects.toBeInstanceOf(
      RoutingError,
    );
    await expect(
      clientWith(mockFetch(200, { code: 'Ok', routes: [{ distance: 'x' }] })).route(from, to),
    ).rejects.toBeInstanceOf(RoutingError);
  });

  it('melempar RoutingError saat jaringan gagal atau timeout', async () => {
    const failing = vi.fn(async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    });
    const c = createOsrmClient({
      baseUrl: 'http://osrm.test',
      timeoutMs: 500,
      fetchImpl: failing as unknown as typeof fetch,
    });
    await expect(c.route(from, to)).rejects.toBeInstanceOf(RoutingError);
  });
});
