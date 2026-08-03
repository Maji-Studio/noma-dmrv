import { z } from 'zod';

const optionalNumber = z.number().finite().optional().nullable();
const optionalString = z.string().trim().min(1).optional().nullable();

// Distance-based only: a leg needs distance + cargo mass. The emission factor
// is supplied by the Isometric component blueprint, not by us (Eq. 3).
export const transportLegConditionSchema = z
  .object({
    calculation_method: z.enum(['distance_based']).default('distance_based'),
    load_mass_kg: optionalNumber,
    vehicle_type: optionalString,
    distance_km: optionalNumber,
  })
  .superRefine((value, ctx) => {
    if (value.load_mass_kg == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['load_mass_kg'],
        message: "Load mass is required",
      });
    }

    if (value.distance_km == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['distance_km'],
        message: "Distance is required",
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
          message: "H/C_org ratio is required for 200-year durability",
        });
      }
    }

    if (value.durability_option === '1000_year') {
      if (value.mean_random_reflectance_percent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mean_random_reflectance_percent'],
          message:
            "Mean random reflectance is required for 1000-year durability",
        });
      }

      if (value.mean_non_reactive_carbon_percent == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mean_non_reactive_carbon_percent'],
          message:
            "Mean non-reactive carbon is required for 1000-year durability",
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
        message: "Soil temperature is required for 200-year durability",
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
      ["phosphorus_g_per_kg", "Phosphorus"],
      ["potassium_g_per_kg", "Potassium"],
      ["magnesium_g_per_kg", "Magnesium"],
      ["calcium_g_per_kg", "Calcium"],
      ["iron_g_per_kg", "Iron"],
    ];

    for (const [fieldKey, fieldName] of nutrientFields) {
      if (value[fieldKey] != null) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldKey],
        message: `${fieldName} is required when nutrient claims are enabled`,
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
        message: "Dry mass must be 0 kg or more",
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
        message: "Dry mass cannot exceed delivered wet mass",
      });
    }
  });

export const documentMetadataSchema = z.object({
  metadata: z.record(z.string(), z.unknown()),
});
