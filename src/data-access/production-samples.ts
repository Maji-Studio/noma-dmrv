/**
 * Production Samples Data Access Layer
 * CRUD operations for in-process field measurements with auth guards
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { productionSamples, operators } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";
import { SafeError } from "@/lib/errors";
import { retireDocumentsForEntities } from "./documents";

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
  ctx: OrgContext,
  productionRunId: string
): Promise<ProductionSampleWithRelations[]> {
  requireOrgScope(ctx);

  return db
    .select(sampleSelect)
    .from(productionSamples)
    .leftJoin(operators, and(eq(productionSamples.sampledById, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .where(and(eq(productionSamples.productionRunId, productionRunId), eq(productionSamples.organizationId, ctx.organizationId)))
    .orderBy(asc(productionSamples.timestamp));
}

/**
 * Get a single production sample by ID
 */
export async function getProductionSampleById(
  ctx: OrgContext,
  id: string
): Promise<ProductionSampleWithRelations> {
  requireOrgScope(ctx);

  const rows = await db
    .select(sampleSelect)
    .from(productionSamples)
    .leftJoin(operators, and(eq(productionSamples.sampledById, operators.id), eq(operators.organizationId, ctx.organizationId)))
    .where(and(eq(productionSamples.id, id), eq(productionSamples.organizationId, ctx.organizationId)));

  if (rows.length === 0) {
    throw new SafeError("Production sample not found");
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
  ctx: OrgContext,
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
  requireOrgScope(ctx);
  if (data.sampledById) await assertSameOrg(ctx, operators, data.sampledById);

  const [inserted] = await db
    .insert(productionSamples)
    .values({
      organizationId: ctx.organizationId,
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

  return getProductionSampleById(ctx, inserted.id);
}

// ============================================
// Update Operations
// ============================================

/**
 * Update an existing production sample
 */
export async function updateProductionSample(
  ctx: OrgContext,
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
  requireOrgScope(ctx);
  if (data.sampledById) await assertSameOrg(ctx, operators, data.sampledById);

  await db
    .update(productionSamples)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(productionSamples.id, id), eq(productionSamples.organizationId, ctx.organizationId)));

  return getProductionSampleById(ctx, id);
}

// ============================================
// Delete Operations
// ============================================

/**
 * Delete a production sample
 */
export async function deleteProductionSample(
  ctx: OrgContext,
  id: string
): Promise<void> {
  requireOrgScope(ctx);

  const deleted = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(productionSamples)
      .where(and(eq(productionSamples.id, id), eq(productionSamples.organizationId, ctx.organizationId)))
      .returning({ id: productionSamples.id });
    await retireDocumentsForEntities(ctx, tx, [
      { entityType: "production_sample", entityId: id },
    ]);
    return rows;
  });

  if (deleted.length === 0) {
    throw new SafeError("Production sample not found");
  }
}
