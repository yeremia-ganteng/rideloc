import { z } from 'zod';

/** All money is integer rupiah. Fractions are rejected so fare math stays exact. */
const RupiahSchema = z.number().int().min(0).max(10_000_000);

export const VehiclePricingSchema = z.object({
  base: RupiahSchema,
  perKm: RupiahSchema,
  perMinute: RupiahSchema,
  minimum: RupiahSchema,
});
export type VehiclePricing = z.infer<typeof VehiclePricingSchema>;

export const PricingConfigSchema = z.object({
  MOTORCYCLE: VehiclePricingSchema,
  CAR: VehiclePricingSchema,
});
export type PricingConfig = z.infer<typeof PricingConfigSchema>;

/** Illustrative placeholders, NOT real market data. Override with PRICING_JSON. */
export const DEFAULT_PRICING: PricingConfig = {
  MOTORCYCLE: { base: 2000, perKm: 2500, perMinute: 200, minimum: 8000 },
  CAR: { base: 5000, perKm: 4000, perMinute: 400, minimum: 15000 },
};
