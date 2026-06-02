/**
 * Production-run reading (time-series) operations.
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionRuns, productionRunReadings } from "@/db/schema";
import { requireAuth } from "../utils";
import { SafeError } from "@/lib/errors";
import type { ProductionRunReadingRecord } from "./types";

/**
 * Get production run readings (time-series data)
 */
export async function getProductionRunReadings(
  userId: string,
  productionRunId: string
): Promise<ProductionRunReadingRecord[]> {
  requireAuth(userId);

  // Verify run exists
  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, productionRunId));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  return db
    .select()
    .from(productionRunReadings)
    .where(eq(productionRunReadings.productionRunId, productionRunId))
    .orderBy(asc(productionRunReadings.timestamp));
}

/**
 * Add a reading to a production run
 */
export async function addProductionRunReading(
  userId: string,
  data: {
    productionRunId: string;
    timestamp: Date;
    temperatureC?: number | null;
    pressureBar?: number | null;
    gasFlowRate?: number | null;
  }
): Promise<ProductionRunReadingRecord> {
  requireAuth(userId);

  // Verify run exists
  const [run] = await db
    .select({ id: productionRuns.id })
    .from(productionRuns)
    .where(eq(productionRuns.id, data.productionRunId));

  if (!run) {
    throw new SafeError("Production run not found");
  }

  const [reading] = await db
    .insert(productionRunReadings)
    .values({
      productionRunId: data.productionRunId,
      timestamp: data.timestamp,
      temperatureC: data.temperatureC ?? null,
      pressureBar: data.pressureBar ?? null,
      gasFlowRate: data.gasFlowRate ?? null,
    })
    .returning();

  return reading;
}
