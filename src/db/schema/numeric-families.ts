import { numeric } from 'drizzle-orm/pg-core';

/**
 * Exact numeric column families for credit-bearing values (issue #280).
 *
 * Credit math (masses, CO2e, contaminant concentrations, ratios, percents)
 * must round-trip exactly what operators entered, so these columns use
 * `numeric(p,s)` instead of float4. `mode: 'number'` keeps the inferred
 * TypeScript type `number`, so no application code changes ripple.
 * Values exceeding a family's precision now fail loudly with a Postgres
 * `numeric field overflow` instead of silently losing digits.
 *
 * Telemetry, in-process QC, and lab characterization columns stay `real`.
 */

/** Mass in kilograms — gram resolution, up to ~100 billion kg. */
export const massKg = (name: string) =>
  numeric(name, { precision: 14, scale: 3, mode: 'number' });

/** Mass / CO2e in metric tonnes — gram (micro-tonne) resolution. */
export const tonnes = (name: string) =>
  numeric(name, { precision: 14, scale: 6, mode: 'number' });

/** Contaminant concentrations (mg/kg, ng/kg, ppm) — 4 decimal places. */
export const ppm = (name: string) =>
  numeric(name, { precision: 10, scale: 4, mode: 'number' });

/** Dimensionless ratios / fractions in [0, 1] — e.g. H/C_org, F_durable. */
export const fraction = (name: string) =>
  numeric(name, { precision: 7, scale: 6, mode: 'number' });

/**
 * Percent values on a 0–100 scale. Deliberately numeric(9,6), not the
 * issue's numeric(7,6): scale 6 leaves (7,6) a single integer digit
 * (max 9.999999), which cannot hold 0–100 scaled values.
 */
export const percent = (name: string) =>
  numeric(name, { precision: 9, scale: 6, mode: 'number' });
