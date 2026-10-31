import { describe, expect, it } from 'vitest';
import { parseGeoSearchWithDist } from './geo-candidates';

describe('parseGeoSearchWithDist', () => {
  it('membaca pasangan [member, jarak] dan membulatkan jarak, urutan dipertahankan', () => {
    expect(
      parseGeoSearchWithDist([
        ['driver-a', '1000.4321'],
        ['driver-b', '2500.9'],
      ]),
    ).toEqual([
      { driverId: 'driver-a', distanceM: 1000 },
      { driverId: 'driver-b', distanceM: 2501 },
    ]);
  });

  it('mengabaikan entri rusak tanpa melempar', () => {
    expect(
      parseGeoSearchWithDist([
        ['ok', '10'],
        'string',
        [1, '5'],
        ['no-dist'],
        ['neg', '-3'],
        ['nan', 'x'],
      ]),
    ).toEqual([{ driverId: 'ok', distanceM: 10 }]);
  });

  it('bukan array menghasilkan daftar kosong', () => {
    expect(parseGeoSearchWithDist(null)).toEqual([]);
    expect(parseGeoSearchWithDist('x')).toEqual([]);
    expect(parseGeoSearchWithDist([])).toEqual([]);
  });
});
