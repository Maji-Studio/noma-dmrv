import { sql } from 'drizzle-orm';
import {
  check,
  date,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// ============================================
// Emission Factors - Regional emission factor configuration
// Isometric Protocol: Energy Use Accounting Module v1.2, Transportation Module v1.1
// Stores emission factors for different fuel types and electricity by region
// ============================================

export const emissionFactors = pgTable(
  'emission_factors',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // --- Region & Fuel Type ---
    country: text('country').notNull(), // e.g., "Tanzania", "Kenya", "Global"
    region: text('region'), // Optional: specific region within country
    fuelType: text('fuel_type').notNull(), // 'diesel', 'biodiesel', 'gasoline', 'electricity', 'natural_gas'

    // --- Emission Factor ---
    // For fuels: kg CO₂e per liter
    // For electricity: kg CO₂e per kWh
    emissionFactorKgCo2ePerUnit: real('emission_factor_kg_co2e_per_unit').notNull(),
    unit: text('unit').notNull(), // 'liter' (for fuels) or 'kWh' (for electricity)

    // --- Metadata ---
    source: text('source').notNull(), // e.g., 'IPCC 2021', 'Tanzania National Database', 'IEA 2023'
    sourceUrl: text('source_url'),
    notes: text('notes'), // Additional context or methodology notes

    // --- Validity Period ---
    validFrom: date('valid_from').notNull(), // When this factor becomes valid
    validTo: date('valid_to').notNull(), // When this factor expires

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    check(
      'emission_factors_validity_window',
      sql`${table.validFrom} <= ${table.validTo}`
    ),
    unique('emission_factors_country_region_fuel_unit_valid_from_unique').on(
      table.country,
      table.region,
      table.fuelType,
      table.unit,
      table.validFrom
    ),
  ]
);

// Note: No relations needed - this is a configuration/lookup table
// Used by calculation functions in lib/calculations/emissions.ts
