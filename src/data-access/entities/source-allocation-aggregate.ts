import { eq } from "drizzle-orm";
import { db } from "@/db";
import { sumNumeric } from "@/db/aggregate";
import { biocharProductSourceAllocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";

/** Org-scoped source dry-biochar totals shared by product and order pickers. */
export function buildSourceAllocationAggregate(ctx: OrgContext) {
  return db
    .select({
      biocharProductId: biocharProductSourceAllocations.biocharProductId,
      allocatedDryMassKg: sumNumeric(
        biocharProductSourceAllocations.allocatedDryMassKg,
      ).as("allocated_dry_mass_kg"),
    })
    .from(biocharProductSourceAllocations)
    .where(eq(
      biocharProductSourceAllocations.organizationId,
      ctx.organizationId,
    ))
    .groupBy(biocharProductSourceAllocations.biocharProductId)
    .as("source_allocation_agg");
}
