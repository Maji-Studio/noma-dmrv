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
import { optionalFacilityIdSchema } from "./facility-id";

// Route Handler JSON delivers a Date filter as an ISO string, while a Server
// Action caller still passes a Date. Both are accepted; anything else (a null
// boundary in particular) is rejected rather than coerced to the epoch.
const INVALID_DATE_FILTER = "Enter a valid date.";
// The string form is validated as a timestamp before it is converted, so a
// loose value like "2026" or "Friday" is refused instead of silently becoming
// some other instant. `{ offset: true }` also accepts a numeric UTC offset.
const transportDateSchema = z
  .union(
    [z.date(), z.iso.datetime({ offset: true, error: INVALID_DATE_FILTER })],
    INVALID_DATE_FILTER,
  )
  .pipe(z.coerce.date(INVALID_DATE_FILTER))
  .optional();

const productionRunReadFilterSchema = productionRunFilterSchema.extend({
  startDate: transportDateSchema,
  endDate: transportDateSchema,
});

/** One filtered page of Production Runs, for both read transports. */
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

/** Production Run totals for one facility, or for the whole organization. */
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
