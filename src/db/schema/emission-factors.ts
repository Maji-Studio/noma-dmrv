/**
 * Per-facility emission factors for the operator-facing energy estimates
 * (ADR 0031).
 *
 * The energy page multiplies the activity operators record (litres of diesel,
 * kWh of grid electricity, tonne-km of road freight) by these factors to show
 * an estimated kg CO2e per record. They never reach a registry submission:
 * Isometric binds its own factors on the removal template and owns project
 * emissions (ADR 0018), so nothing here can change a submitted figure.
 *
 * One row per facility. No row means "not set", and the page then shows
 * activity units only. All three factors are required on save, so a row is
 * either complete or absent; grid electricity has no default because it is
 * country-specific.
 */
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { facilities } from "./facilities";
import { emissionFactor } from "./numeric-families";

export const facilityEmissionFactors = pgTable(
  "facility_emission_factors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    facilityId: uuid("facility_id").notNull(),

    /** kg CO2e per litre of diesel (startup, genset and preprocessing fuel). */
    dieselKgCo2ePerLitre: emissionFactor("diesel_kg_co2e_per_litre").notNull(),
    /** kg CO2e per kWh of grid electricity, before any low-carbon share. */
    gridKgCo2ePerKwh: emissionFactor("grid_kg_co2e_per_kwh").notNull(),
    /** kg CO2e per tonne-km of road freight (feedstock and biochar trucks). */
    roadFreightKgCo2ePerTonneKm: emissionFactor(
      "road_freight_kg_co2e_per_tonne_km",
    ).notNull(),
    /** Where the factors come from (a dataset, a year, an LCA). */
    sourceNote: text("source_note"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    unique("facility_emission_factors_facility_id_unique").on(table.facilityId),
    index("facility_emission_factors_organization_id_idx").on(
      table.organizationId,
    ),
    foreignKey({
      columns: [table.facilityId, table.organizationId],
      foreignColumns: [facilities.id, facilities.organizationId],
    }),
    check(
      "facility_emission_factors_non_negative",
      sql`${table.dieselKgCo2ePerLitre} >= 0 and ${table.gridKgCo2ePerKwh} >= 0 and ${table.roadFreightKgCo2ePerTonneKm} >= 0`,
    ),
  ],
);

export type FacilityEmissionFactorsRow =
  typeof facilityEmissionFactors.$inferSelect;
