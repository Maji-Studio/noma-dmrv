/**
 * Production Run Readings Data Access Layer
 *
 * Readings are imported from readings CSVs (see
 * `production-run-reading-imports.ts`). This module exposes read access plus a
 * bulk "delete all" used to clear a run before re-importing a corrected CSV.
 */

import { and, desc, eq, SQL } from "drizzle-orm";
import { db } from "@/db";
import { productionRunReadings, productionRuns } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";

// ============================================
// Types
// ============================================

export interface ProductionRunReadingWithRelations {
  id: string;
  productionRunId: string;
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
  dryerFrequencyHz: number | null;
  reactorFrequencyHz: number | null;
  createdAt: Date;
  productionRunCode: string | null;
  facilityId: string;
}

// ============================================
// Shared projection
// ============================================

const readingSelect = {
  id: productionRunReadings.id,
  productionRunId: productionRunReadings.productionRunId,
  timestamp: productionRunReadings.timestamp,
  temperatureC: productionRunReadings.temperatureC,
  pressureBar: productionRunReadings.pressureBar,
  gasFlowRate: productionRunReadings.gasFlowRate,
  dryerFrequencyHz: productionRunReadings.dryerFrequencyHz,
  reactorFrequencyHz: productionRunReadings.reactorFrequencyHz,
  createdAt: productionRunReadings.createdAt,
  productionRunCode: productionRuns.code,
  facilityId: productionRuns.facilityId,
} as const;

// ============================================
// Read Operations
// ============================================

export async function getProductionRunReadingsList(
  ctx: OrgContext,
  productionRunId?: string,
  facilityId?: string
): Promise<ProductionRunReadingWithRelations[]> {
  requireOrgScope(ctx);

  const conditions: SQL[] = [
    eq(productionRunReadings.organizationId, ctx.organizationId),
    eq(productionRuns.organizationId, ctx.organizationId),
  ];

  if (productionRunId) {
    conditions.push(
      eq(productionRunReadings.productionRunId, productionRunId)
    );
  }

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  return db
    .select(readingSelect)
    .from(productionRunReadings)
    .innerJoin(
      productionRuns,
      eq(productionRunReadings.productionRunId, productionRuns.id)
    )
    .where(and(...conditions))
    .orderBy(desc(productionRunReadings.timestamp));
}

// ============================================
// Delete
// ============================================

/**
 * Delete every reading for a production run. Returns the number of rows
 * removed so callers can confirm the reset. Used to clear stale/incorrect
 * telemetry before re-importing a readings CSV.
 */
export async function deleteAllProductionRunReadings(
  ctx: OrgContext,
  productionRunId: string
): Promise<number> {
  requireOrgScope(ctx);

  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(and(eq(productionRuns.id, productionRunId), eq(productionRuns.organizationId, ctx.organizationId)));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  const deleted = await db
    .delete(productionRunReadings)
    .where(and(eq(productionRunReadings.productionRunId, productionRunId), eq(productionRunReadings.organizationId, ctx.organizationId)))
    .returning({ id: productionRunReadings.id });

  return deleted.length;
}
