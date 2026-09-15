import { z } from "zod";

import {
  getProductionRuns,
  getProductionRunStats,
  type PaginatedProductionRuns,
  type ProductionRunStats,
} from "@/data-access/production-runs";
import { requireOrgFacility } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { productionRunFilterSchema } from "@/schemas/production-runs";

// Route Handler JSON turns Date inputs into strings. The transport-neutral
// orchestration core accepts both representations, while the existing action
// and data-access interfaces continue to operate on Date values.
const productionRunReadFilterSchema = productionRunFilterSchema.extend({
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});
const optionalFacilityIdSchema = z
  .string()
  .uuid("Choose a valid facility.")
  .optional();

export async function readProductionRuns(
  ctx: OrgContext,
  input?: unknown,
): Promise<PaginatedProductionRuns> {
  const filters = productionRunReadFilterSchema.parse(input ?? {});
  if (filters.facilityId) {
    await requireOrgFacility(ctx, filters.facilityId);
  }
  return getProductionRuns(ctx, filters);
}

export async function readProductionRunStats(
  ctx: OrgContext,
  input?: unknown,
): Promise<ProductionRunStats> {
  const facilityId = optionalFacilityIdSchema.parse(input);
  if (facilityId) {
    await requireOrgFacility(ctx, facilityId);
  }
  return getProductionRunStats(ctx, facilityId);
}
