import { z } from 'zod';

const optionalNumber = z.number().finite().optional().nullable();
const optionalString = z.string().trim().min(1).optional().nullable();
const uuidLikeString = z.string().regex(
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  {
    message: 'must be a valid UUID string',
  }
);

export const transportLegConditionSchema = z
  .object({
    calculation_method: z.enum(['energy_usage', 'distance_based']),
    fuel_type: optionalString,
    fuel_consumed_liters: optionalNumber,
    electricity_kwh: optionalNumber,
    load_mass_kg: optionalNumber,
    vehicle_type: optionalString,
    distance_km: optionalNumber,
    emission_factor_used: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.calculation_method === 'energy_usage') {
      if (!value.fuel_type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fuel_type'],
          message: 'fuel_type is required when calculation_method=energy_usage',
        });
      }

      if (
        value.fuel_consumed_liters == null &&
        value.electricity_kwh == null
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fuel_consumed_liters'],
          message:
            'fuel_consumed_liters or electricity_kwh is required when calculation_method=energy_usage',
        });
      }
    }

    if (value.calculation_method === 'distance_based') {
      if (value.load_mass_kg == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['load_mass_kg'],
          message:
            'load_mass_kg is required when calculation_method=distance_based',
        });
      }

      if (!value.vehicle_type) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['vehicle_type'],
          message:
            'vehicle_type is required when calculation_method=distance_based',
        });
      }
    }

    if (value.emission_factor_used == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['emission_factor_used'],
        message:
          'emission_factor_used is required when calculation_method is provided',
      });
    }

    if (value.distance_km == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['distance_km'],
        message: 'distance_km is required',
      });
    }
  });

// Soil temperature validation lives at the application level, not credit batch.
// See applicationSoilTemperatureSchema below.
export const creditBatchConditionSchema = z
  .object({
    durability_option: z.enum(['200_year', '1000_year']),
    h_to_c_org_ratio: optionalNumber,
    mean_random_reflectance_percent: optionalNumber,
    mean_non_reactive_carbon_percent: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.durability_option === '200_year') {
      if (value.h_to_c_org_ratio == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['h_to_c_org_ratio'],
          message: 'h_to_c_org_ratio is required when durability_option=200_year',
        });
      }
    }

    if (value.durability_option === '1000_year') {
      if (value.mean_random_reflectance_percent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mean_random_reflectance_percent'],
          message:
            'mean_random_reflectance_percent is required when durability_option=1000_year',
        });
      }

      if (value.mean_non_reactive_carbon_percent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mean_non_reactive_carbon_percent'],
          message:
            'mean_non_reactive_carbon_percent is required when durability_option=1000_year',
        });
      }
    }
  });

export const applicationSoilTemperatureSchema = z
  .object({
    soil_temperature_source: z.enum(['baseline', 'global_database']),
    soil_temperature_c: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.soil_temperature_c == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['soil_temperature_c'],
        message: 'soil_temperature_c is required for 200-year durability calculation',
      });
    }
  });

export const reactorSamplingMethodSchema = z
  .object({
    reactor_id: uuidLikeString,
    sampling_method: z.enum(['method_a', 'method_b']),
    prior_method_a_sample_count: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.sampling_method !== 'method_b') {
      return;
    }

    if (
      value.prior_method_a_sample_count != null &&
      value.prior_method_a_sample_count < 30
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sampling_method'],
        message:
          'sampling_method=method_b requires at least 30 prior samples under Method A',
      });
    }
  });

export const sampleConditionSchema = z
  .object({
    nutrient_claim_enabled: z.boolean().default(false),
    phosphorus_g_per_kg: optionalNumber,
    potassium_g_per_kg: optionalNumber,
    magnesium_g_per_kg: optionalNumber,
    calcium_g_per_kg: optionalNumber,
    iron_g_per_kg: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (!value.nutrient_claim_enabled) return;

    const nutrientFields: Array<[keyof typeof value, string]> = [
      ['phosphorus_g_per_kg', 'phosphorus_g_per_kg'],
      ['potassium_g_per_kg', 'potassium_g_per_kg'],
      ['magnesium_g_per_kg', 'magnesium_g_per_kg'],
      ['calcium_g_per_kg', 'calcium_g_per_kg'],
      ['iron_g_per_kg', 'iron_g_per_kg'],
    ];

    for (const [fieldKey, fieldName] of nutrientFields) {
      if (value[fieldKey] != null) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldKey],
        message: `${fieldName} is required when nutrient_claim_enabled=true`,
      });
    }
  });

export const continuousGasMeasurementSchema = z
  .object({
    continuous_gas_measurement: z.boolean().default(false),
    ch4_ppm: optionalNumber,
    n2o_ppm: optionalNumber,
    co_ppm: optionalNumber,
    co2_ppm: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (!value.continuous_gas_measurement) return;

    const ppmFields: Array<[keyof typeof value, string]> = [
      ['ch4_ppm', 'ch4_ppm'],
      ['n2o_ppm', 'n2o_ppm'],
      ['co_ppm', 'co_ppm'],
      ['co2_ppm', 'co2_ppm'],
    ];

    for (const [fieldKey, fieldName] of ppmFields) {
      if (value[fieldKey] != null) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldKey],
        message: `${fieldName} is required when continuous_gas_measurement=true`,
      });
    }
  });

export const deliveryDryMassSchema = z
  .object({
    mass_dry_kg: optionalNumber,
    delivered_wet_mass_kg: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.mass_dry_kg != null && value.mass_dry_kg < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mass_dry_kg'],
        message: 'mass_dry_kg must be >= 0',
      });
    }

    if (
      value.mass_dry_kg != null &&
      value.delivered_wet_mass_kg != null &&
      value.mass_dry_kg > value.delivered_wet_mass_kg
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mass_dry_kg'],
        message: 'mass_dry_kg must be <= delivered_wet_mass_kg',
      });
    }
  });

export const documentMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
});
