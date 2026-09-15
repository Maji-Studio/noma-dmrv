import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { applications } from "./application";
import { organizations } from "./auth";
import { deliveries } from "./logistics";
import { exactMassKg } from "./numeric-families";
import { productionRuns } from "./production";
import { biocharProducts } from "./products";

/** Frozen application × product × source-run shares of the saved truck. */
export const applicationOutputAllocations = pgTable("application_output_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  applicationId: uuid("application_id").notNull(),
  deliveryId: uuid("delivery_id").notNull(),
  biocharProductId: uuid("biochar_product_id").notNull(),
  productionRunId: uuid("production_run_id").notNull(),
  wetMassKg: exactMassKg("wet_mass_kg").notNull(),
  dryMassKg: exactMassKg("dry_mass_kg").notNull(),
}, t => [
  index("application_output_allocations_org_delivery_idx").on(t.organizationId, t.deliveryId),
  unique("application_output_allocations_application_product_run_unique").on(t.applicationId, t.biocharProductId, t.productionRunId),
  foreignKey({ columns: [t.applicationId, t.organizationId], foreignColumns: [applications.id, applications.organizationId] }),
  foreignKey({ columns: [t.deliveryId, t.organizationId], foreignColumns: [deliveries.id, deliveries.organizationId] }),
  foreignKey({ columns: [t.biocharProductId, t.organizationId], foreignColumns: [biocharProducts.id, biocharProducts.organizationId] }),
  foreignKey({ columns: [t.productionRunId, t.organizationId], foreignColumns: [productionRuns.id, productionRuns.organizationId] }),
  check("application_output_allocations_nonnegative", sql`${t.wetMassKg} >= 0 and ${t.dryMassKg} >= 0`),
]);
