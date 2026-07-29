/**
 * Production Run Readings Validation Schemas
 *
 * Readings are sourced exclusively from readings CSV imports — there is no
 * manual create/edit path. The only mutation surface is "delete all", which
 * clears a run's readings so a corrected CSV can be re-imported.
 */

import { z } from "zod";

// ============================================
// Query Schemas
// ============================================

export const productionRunReadingListFiltersSchema = z.object({
  productionRunId: z.string().uuid("Choose a valid production run.").optional(),
  facilityId: z.string().uuid("Choose a valid facility.").optional(),
});

// ============================================
// Mutation Schemas
// ============================================

export const deleteAllProductionRunReadingsSchema = z.object({
  productionRunId: z.string().uuid("Choose a valid production run."),
});

// ============================================
// Type Inference
// ============================================

export type DeleteAllProductionRunReadingsData = z.infer<
  typeof deleteAllProductionRunReadingsSchema
>;
