/**
 * Read-only helper for Phase 5 Slice A telemetry aggregation
 * (ADR 0006).
 *
 * Pulls `production_run_readings` joined to `production_runs.reactor_id`
 * for a set of runs, optionally clipped to a clock window. Output is
 * the shape `transformers/data-upload.ts` consumes. Lives outside
 * `production-runs.ts` to keep that file under the 1000-line cap and
 * because the join shape is telemetry-specific.
 */

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { productionRunReadings, productionRuns } from "@/db/schema/production";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export interface TelemetryReadingRow {
  reactorId: string;
  productionRunId: string;
  timestamp: Date;
  temperatureC: number | null;
  pressureBar: number | null;
  gasFlowRate: number | null;
}

export interface ListReadingsArgs {
  productionRunIds: string[];
  /** Inclusive clock-window bounds. Both optional. */
  since?: Date;
  until?: Date;
}

export async function listTelemetryReadingsForRuns(
  ctx: OrgContext,
  args: ListReadingsArgs,
): Promise<TelemetryReadingRow[]> {
  requireOrgScope(ctx);
  if (args.productionRunIds.length === 0) return [];

  const conditions = [
    inArray(productionRunReadings.productionRunId, args.productionRunIds),
    eq(productionRunReadings.organizationId, ctx.organizationId),
    eq(productionRuns.organizationId, ctx.organizationId),
  ];
  if (args.since) {
    conditions.push(gte(productionRunReadings.timestamp, args.since));
  }
  if (args.until) {
    conditions.push(lte(productionRunReadings.timestamp, args.until));
  }

  const rows = await db
    .select({
      reactorId: productionRuns.reactorId,
      productionRunId: productionRunReadings.productionRunId,
      timestamp: productionRunReadings.timestamp,
      temperatureC: productionRunReadings.temperatureC,
      pressureBar: productionRunReadings.pressureBar,
      gasFlowRate: productionRunReadings.gasFlowRate,
    })
    .from(productionRunReadings)
    .innerJoin(
      productionRuns,
      eq(productionRunReadings.productionRunId, productionRuns.id),
    )
    .where(and(...conditions));
  return rows;
}
