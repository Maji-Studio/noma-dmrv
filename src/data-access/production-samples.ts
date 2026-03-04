/**
 * Production Samples Data Access Layer
 * CRUD operations for in-process field measurements with auth guards
 */

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionSamples, operators } from "@/db/schema";
import { requireAuth } from "./utils";

// ============================================
// Types
// ============================================

export interface ProductionSampleWithRelations {
  id: string;
  productionRunId: string;
  sampleCode: string | null;
  timestamp: Date;
  weightGrams: number | null;
  volumeMl: number | null;
  temperatureC: number | null;
  moistureContentPercent: number | null;
  fixedCarbonPercent: number | null;
  volatileMatterPercent: number | null;
  ashContentPercent: number | null;
  photoUrl: string | null;
  sampledById: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Relations
  operatorName: string | null;
}

// Shared select projection used by all read queries
const sampleSelect = {
  id: productionSamples.id,
  productionRunId: productionSamples.productionRunId,
  sampleCode: productionSamples.sampleCode,
  timestamp: productionSamples.timestamp,
  weightGrams: productionSamples.weightGrams,
  volumeMl: productionSamples.volumeMl,
  temperatureC: productionSamples.temperatureC,
  moistureContentPercent: productionSamples.moistureContentPercent,
  fixedCarbonPercent: productionSamples.fixedCarbonPercent,
  volatileMatterPercent: productionSamples.volatileMatterPercent,
  ashContentPercent: productionSamples.ashContentPercent,
  photoUrl: productionSamples.photoUrl,
  sampledById: productionSamples.sampledById,
  notes: productionSamples.notes,
  createdAt: productionSamples.createdAt,
  updatedAt: productionSamples.updatedAt,
  operatorName: operators.name,
} as const;

// ============================================
// Read Operations
// ============================================

/**
 * Get all production samples for a specific production run
 */
export async function getProductionSamples(
  userId: string,
  productionRunId: string
): Promise<ProductionSampleWithRelations[]> {
  requireAuth(userId);

  return db
    .select(sampleSelect)
    .from(productionSamples)
    .leftJoin(operators, eq(productionSamples.sampledById, operators.id))
    .where(eq(productionSamples.productionRunId, productionRunId))
    .orderBy(asc(productionSamples.timestamp));
}

/**
 * Get a single production sample by ID
 */
export async function getProductionSampleById(
  userId: string,
  id: string
): Promise<ProductionSampleWithRelations> {
  requireAuth(userId);

  const rows = await db
    .select(sampleSelect)
    .from(productionSamples)
    .leftJoin(operators, eq(productionSamples.sampledById, operators.id))
    .where(eq(productionSamples.id, id));

  if (rows.length === 0) {
    throw new Error("Production sample not found");
  }

  return rows[0];
}

// ============================================
// Create Operations
// ============================================

/**
 * Create a new production sample
 */
export async function createProductionSample(
  userId: string,
  data: {
    productionRunId: string;
    sampleCode?: string | null;
    timestamp: Date;
    weightGrams?: number | null;
    volumeMl?: number | null;
    temperatureC?: number | null;
    moistureContentPercent?: number | null;
    fixedCarbonPercent?: number | null;
    volatileMatterPercent?: number | null;
    ashContentPercent?: number | null;
    photoUrl?: string | null;
    sampledById?: string | null;
    notes?: string | null;
  }
): Promise<ProductionSampleWithRelations> {
  requireAuth(userId);

  const [inserted] = await db
    .insert(productionSamples)
    .values({
      productionRunId: data.productionRunId,
      sampleCode: data.sampleCode ?? null,
      timestamp: data.timestamp,
      weightGrams: data.weightGrams ?? null,
      volumeMl: data.volumeMl ?? null,
      temperatureC: data.temperatureC ?? null,
      moistureContentPercent: data.moistureContentPercent ?? null,
      fixedCarbonPercent: data.fixedCarbonPercent ?? null,
      volatileMatterPercent: data.volatileMatterPercent ?? null,
      ashContentPercent: data.ashContentPercent ?? null,
      photoUrl: data.photoUrl ?? null,
      sampledById: data.sampledById ?? null,
      notes: data.notes ?? null,
    })
    .returning({ id: productionSamples.id });

  return getProductionSampleById(userId, inserted.id);
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing production sample
 */
export async function updateProductionSample(
  userId: string,
  id: string,
  data: {
    timestamp?: Date;
    weightGrams?: number | null;
    volumeMl?: number | null;
    temperatureC?: number | null;
    moistureContentPercent?: number | null;
    fixedCarbonPercent?: number | null;
    volatileMatterPercent?: number | null;
    ashContentPercent?: number | null;
    photoUrl?: string | null;
    sampledById?: string | null;
    notes?: string | null;
  }
): Promise<ProductionSampleWithRelations> {
  requireAuth(userId);

  await db
    .update(productionSamples)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(productionSamples.id, id));

  return getProductionSampleById(userId, id);
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a production sample
 */
export async function deleteProductionSample(
  userId: string,
  id: string
): Promise<void> {
  requireAuth(userId);

  const deleted = await db
    .delete(productionSamples)
    .where(eq(productionSamples.id, id))
    .returning({ id: productionSamples.id });

  if (deleted.length === 0) {
    throw new Error("Production sample not found");
  }
}
