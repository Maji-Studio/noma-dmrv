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
  productionRunId: z.string().uuid("Invalid production run ID").optional(),
  facilityId: z.string().uuid("Invalid facility ID").optional(),
});

// ============================================
// Mutation Schemas
// ============================================

export const deleteAllProductionRunReadingsSchema = z.object({
  productionRunId: z.string().uuid("Invalid production run ID"),
});

// ============================================
// Type Inference
// ============================================

export type DeleteAllProductionRunReadingsData = z.infer<
  typeof deleteAllProductionRunReadingsSchema
>;
