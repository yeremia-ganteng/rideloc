import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICING, PricingConfigSchema, VehiclePricingSchema } from './pricing';

describe('pricing schemas', () => {
  it('DEFAULT_PRICING valid terhadap skema', () => {
    expect(PricingConfigSchema.safeParse(DEFAULT_PRICING).success).toBe(true);
  });

  it('menolak nilai pecahan atau negatif', () => {
    const ok = { base: 1, perKm: 1, perMinute: 1, minimum: 1 };
    expect(VehiclePricingSchema.safeParse({ ...ok, perKm: 2500.5 }).success).toBe(false);
    expect(VehiclePricingSchema.safeParse({ ...ok, base: -1 }).success).toBe(false);
  });

  it('menolak konfigurasi yang kehilangan satu jenis kendaraan', () => {
    expect(PricingConfigSchema.safeParse({ MOTORCYCLE: DEFAULT_PRICING.MOTORCYCLE }).success).toBe(
      false,
    );
  });
});
