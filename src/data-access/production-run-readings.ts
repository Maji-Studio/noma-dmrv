/**
 * Production Run Readings Data Access Layer
 * CRUD operations for standalone readings with auth guards
 */

import { and, desc, eq, SQL } from "drizzle-orm";
import { db } from "@/db";
import { productionRunReadings, productionRuns } from "@/db/schema";
import { requireAuth } from "./utils";
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
  createdAt: productionRunReadings.createdAt,
  productionRunCode: productionRuns.code,
  facilityId: productionRuns.facilityId,
} as const;

// ============================================
// Read Operations
// ============================================

export async function getProductionRunReadingsList(
  userId: string,
  productionRunId?: string,
  facilityId?: string
): Promise<ProductionRunReadingWithRelations[]> {
  requireAuth(userId);

  const conditions: SQL[] = [];

  if (productionRunId) {
    conditions.push(
      eq(productionRunReadings.productionRunId, productionRunId)
    );
  }

  if (facilityId) {
    conditions.push(eq(productionRuns.facilityId, facilityId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select(readingSelect)
    .from(productionRunReadings)
    .innerJoin(
      productionRuns,
      eq(productionRunReadings.productionRunId, productionRuns.id)
    )
    .where(whereClause)
    .orderBy(desc(productionRunReadings.timestamp));
}

export async function getProductionRunReadingById(
  userId: string,
  id: string
): Promise<ProductionRunReadingWithRelations> {
  requireAuth(userId);

  const [reading] = await db
    .select(readingSelect)
    .from(productionRunReadings)
    .innerJoin(
      productionRuns,
      eq(productionRunReadings.productionRunId, productionRuns.id)
    )
    .where(eq(productionRunReadings.id, id));

  if (!reading) {
    throw new SafeError("Reading not found");
  }

  return reading;
}

// ============================================
// Create
// ============================================

export async function createProductionRunReading(
  userId: string,
  data: {
    productionRunId: string;
    timestamp: Date;
    temperatureC?: number | null;
    pressureBar?: number | null;
    gasFlowRate?: number | null;
  }
): Promise<ProductionRunReadingWithRelations> {
  requireAuth(userId);

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

  return getProductionRunReadingById(userId, reading.id);
}

// ============================================
// Update
// ============================================

export async function updateProductionRunReading(
  userId: string,
  id: string,
  data: {
    timestamp?: Date;
    temperatureC?: number | null;
    pressureBar?: number | null;
    gasFlowRate?: number | null;
  }
): Promise<ProductionRunReadingWithRelations> {
  requireAuth(userId);

  const [existing] = await db
    .select({ id: productionRunReadings.id })
    .from(productionRunReadings)
    .where(eq(productionRunReadings.id, id));

  if (!existing) {
    throw new SafeError("Reading not found");
  }

  const updateData: Record<string, unknown> = {};
  if (data.timestamp !== undefined) updateData.timestamp = data.timestamp;
  if (data.temperatureC !== undefined)
    updateData.temperatureC = data.temperatureC;
  if (data.pressureBar !== undefined) updateData.pressureBar = data.pressureBar;
  if (data.gasFlowRate !== undefined) updateData.gasFlowRate = data.gasFlowRate;

  if (Object.keys(updateData).length > 0) {
    await db
      .update(productionRunReadings)
      .set(updateData)
      .where(eq(productionRunReadings.id, id));
  }

  return getProductionRunReadingById(userId, id);
}

// ============================================
// Delete
// ============================================

export async function deleteProductionRunReading(
  userId: string,
  id: string
): Promise<void> {
  requireAuth(userId);

  const [existing] = await db
    .select({ id: productionRunReadings.id })
    .from(productionRunReadings)
    .where(eq(productionRunReadings.id, id));

  if (!existing) {
    throw new SafeError("Reading not found");
  }

  await db
    .delete(productionRunReadings)
    .where(eq(productionRunReadings.id, id));
}
