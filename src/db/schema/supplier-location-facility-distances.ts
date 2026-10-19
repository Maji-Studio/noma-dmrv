import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { organizations } from "./auth";
import { distanceSource } from "./common";
import { facilities } from "./facilities";
import { supplierLocations } from "./parties";

export const supplierLocationFacilityDistances = pgTable("supplier_location_facility_distances", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  locationId: uuid("location_id").notNull(),
  facilityId: uuid("facility_id").notNull(),
  distanceKm: real("distance_km").notNull(),
  distanceSource: distanceSource("distance_source").notNull(),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  unique("supplier_location_facility_distance_pair_unique").on(table.locationId, table.facilityId),
  index("supplier_location_facility_distances_org_idx").on(table.organizationId),
  check("supplier_location_facility_distance_positive", sql`${table.distanceKm} > 0`),
  foreignKey({
    columns: [table.locationId, table.organizationId],
    foreignColumns: [supplierLocations.id, supplierLocations.organizationId],
    name: "supplier_location_facility_distance_location_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [table.facilityId, table.organizationId],
    foreignColumns: [facilities.id, facilities.organizationId],
    name: "supplier_location_facility_distance_facility_fk",
  }),
]);
