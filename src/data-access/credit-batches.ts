import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatches,
  creditBatchApplications,
  type CreditBatch,
} from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import type {
  CreateCreditBatchData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";

// ============================================
// Auth Guard
// ============================================

function requireAuth(userId: string): void {
  if (!userId) {
    throw new Error("Unauthorized");
  }
}

// ============================================
// Credit Batch Data Access Layer
// ============================================

export interface CreditBatchWithRelations extends CreditBatch {
  facility: { name: string } | null;
  applicationCount: number;
  applicationIds: string[];
}

/**
 * Get all credit batches with facility info and application count
 */
export async function getCreditBatches(userId: string): Promise<CreditBatchWithRelations[]> {
  requireAuth(userId);
  const batches = await db
    .select({
      creditBatch: creditBatches,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .orderBy(desc(creditBatches.createdAt));

  // Get application counts and IDs for each batch
  const batchIds = batches.map((b) => b.creditBatch.id);

  if (batchIds.length === 0) {
    return [];
  }

  const applicationData = await db
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationId: creditBatchApplications.applicationId,
    })
    .from(creditBatchApplications)
    .where(inArray(creditBatchApplications.creditBatchId, batchIds));

  // Group by batch ID
  const applicationsByBatch = applicationData.reduce(
    (acc, row) => {
      if (!acc[row.creditBatchId]) {
        acc[row.creditBatchId] = [];
      }
      acc[row.creditBatchId].push(row.applicationId);
      return acc;
    },
    {} as Record<string, string[]>
  );

  return batches.map((b) => ({
    ...b.creditBatch,
    facility: b.facilityName ? { name: b.facilityName } : null,
    applicationCount: applicationsByBatch[b.creditBatch.id]?.length ?? 0,
    applicationIds: applicationsByBatch[b.creditBatch.id] ?? [],
  }));
}

/**
 * Get credit batch by ID with full details
 */
export async function getCreditBatchById(
  userId: string,
  id: string
): Promise<CreditBatchWithRelations | null> {
  requireAuth(userId);
  const [batch] = await db
    .select({
      creditBatch: creditBatches,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(eq(creditBatches.id, id));

  if (!batch) {
    return null;
  }

  // Get application IDs
  const applicationData = await db
    .select({
      applicationId: creditBatchApplications.applicationId,
    })
    .from(creditBatchApplications)
    .where(eq(creditBatchApplications.creditBatchId, id));

  return {
    ...batch.creditBatch,
    facility: batch.facilityName ? { name: batch.facilityName } : null,
    applicationCount: applicationData.length,
    applicationIds: applicationData.map((a) => a.applicationId),
  };
}

/**
 * Get credit batch by code
 */
export async function getCreditBatchByCode(
  userId: string,
  code: string
): Promise<CreditBatch | null> {
  requireAuth(userId);
  const [creditBatch] = await db
    .select()
    .from(creditBatches)
    .where(eq(creditBatches.code, code));
  return creditBatch ?? null;
}

/**
 * Create a new credit batch with application links
 */
export async function createCreditBatch(
  userId: string,
  data: CreateCreditBatchData & { code: string }
): Promise<CreditBatchWithRelations> {
  requireAuth(userId);
  const { applicationIds, ...batchData } = data;

  const creditBatch = await db.transaction(async (tx) => {
    // Insert the credit batch
    const [batch] = await tx
      .insert(creditBatches)
      .values({
        code: batchData.code,
        facilityId: batchData.facilityId,
        startDate: batchData.startDate.toISOString().split("T")[0],
        endDate: batchData.endDate.toISOString().split("T")[0],
        certifier: batchData.certifier || null,
        status: batchData.status,
        durabilityOption: batchData.durabilityOption,
        hToCorgRatio: batchData.hToCorgRatio ?? null,
        meanRandomReflectancePercent:
          batchData.meanRandomReflectancePercent ?? null,
        stdRandomReflectance: batchData.stdRandomReflectance ?? null,
        meanNonReactiveCarbonPercent:
          batchData.meanNonReactiveCarbonPercent ?? null,
        stdNonReactiveCarbonPercent:
          batchData.stdNonReactiveCarbonPercent ?? null,
        fDurableCalculated: batchData.fDurableCalculated ?? null,
        totalCo2eStoredTons: batchData.totalCo2eStoredTons ?? null,
        totalCo2eEmissionsTons: batchData.totalCo2eEmissionsTons ?? null,
        totalCo2eCounterfactualTons:
          batchData.totalCo2eCounterfactualTons ?? null,
        bufferPoolPercent: batchData.bufferPoolPercent ?? null,
        registry: batchData.registry || null,
        weightTons: batchData.weightTons ?? null,
        value: batchData.value ?? null,
        currency: batchData.currency,
        siteManagementNotes: batchData.siteManagementNotes || null,
      })
      .returning();

    // Insert application links if any
    if (applicationIds && applicationIds.length > 0) {
      await tx.insert(creditBatchApplications).values(
        applicationIds.map((applicationId) => ({
          creditBatchId: batch.id,
          applicationId,
        }))
      );
    }

    return batch;
  });

  // Fetch facility name
  const [facility] = await db
    .select({ name: facilities.name })
    .from(facilities)
    .where(eq(facilities.id, creditBatch.facilityId));

  return {
    ...creditBatch,
    facility: facility ?? null,
    applicationCount: applicationIds?.length ?? 0,
    applicationIds: applicationIds ?? [],
  };
}

/**
 * Update a credit batch
 */
export async function updateCreditBatch(
  userId: string,
  id: string,
  data: Omit<UpdateCreditBatchData, "creditBatchId">
): Promise<CreditBatchWithRelations> {
  requireAuth(userId);
  const { applicationIds, ...updateFields } = data;

  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  // Only include fields that are explicitly provided
  if (updateFields.code !== undefined) updateData.code = updateFields.code;
  if (updateFields.facilityId !== undefined)
    updateData.facilityId = updateFields.facilityId;
  if (updateFields.startDate !== undefined)
    updateData.startDate = updateFields.startDate.toISOString().split("T")[0];
  if (updateFields.endDate !== undefined)
    updateData.endDate = updateFields.endDate.toISOString().split("T")[0];
  if (updateFields.certifier !== undefined)
    updateData.certifier = updateFields.certifier || null;
  if (updateFields.status !== undefined)
    updateData.status = updateFields.status;
  if (updateFields.durabilityOption !== undefined)
    updateData.durabilityOption = updateFields.durabilityOption;
  if (updateFields.hToCorgRatio !== undefined)
    updateData.hToCorgRatio = updateFields.hToCorgRatio;
  if (updateFields.meanRandomReflectancePercent !== undefined)
    updateData.meanRandomReflectancePercent =
      updateFields.meanRandomReflectancePercent;
  if (updateFields.stdRandomReflectance !== undefined)
    updateData.stdRandomReflectance = updateFields.stdRandomReflectance;
  if (updateFields.meanNonReactiveCarbonPercent !== undefined)
    updateData.meanNonReactiveCarbonPercent =
      updateFields.meanNonReactiveCarbonPercent;
  if (updateFields.stdNonReactiveCarbonPercent !== undefined)
    updateData.stdNonReactiveCarbonPercent =
      updateFields.stdNonReactiveCarbonPercent;
  if (updateFields.fDurableCalculated !== undefined)
    updateData.fDurableCalculated = updateFields.fDurableCalculated;
  if (updateFields.totalCo2eStoredTons !== undefined)
    updateData.totalCo2eStoredTons = updateFields.totalCo2eStoredTons;
  if (updateFields.totalCo2eEmissionsTons !== undefined)
    updateData.totalCo2eEmissionsTons = updateFields.totalCo2eEmissionsTons;
  if (updateFields.totalCo2eCounterfactualTons !== undefined)
    updateData.totalCo2eCounterfactualTons =
      updateFields.totalCo2eCounterfactualTons;
  if (updateFields.bufferPoolPercent !== undefined)
    updateData.bufferPoolPercent = updateFields.bufferPoolPercent;
  if (updateFields.registry !== undefined)
    updateData.registry = updateFields.registry || null;
  if (updateFields.weightTons !== undefined)
    updateData.weightTons = updateFields.weightTons;
  if (updateFields.value !== undefined) updateData.value = updateFields.value;
  if (updateFields.currency !== undefined)
    updateData.currency = updateFields.currency;
  if (updateFields.siteManagementNotes !== undefined)
    updateData.siteManagementNotes = updateFields.siteManagementNotes || null;

  await db.transaction(async (tx) => {
    await tx
      .update(creditBatches)
      .set(updateData)
      .where(eq(creditBatches.id, id));

    // Update application links if provided
    if (applicationIds !== undefined) {
      // Delete existing links
      await tx
        .delete(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, id));

      // Insert new links
      if (applicationIds.length > 0) {
        await tx.insert(creditBatchApplications).values(
          applicationIds.map((applicationId) => ({
            creditBatchId: id,
            applicationId,
          }))
        );
      }
    }
  });

  // Fetch full details
  const result = await getCreditBatchById(userId, id);
  return result!;
}

/**
 * Delete a credit batch and its application links
 */
export async function deleteCreditBatch(userId: string, id: string): Promise<void> {
  requireAuth(userId);
  await db.transaction(async (tx) => {
    // Delete application links first (junction table)
    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.creditBatchId, id));

    // Delete the credit batch
    await tx.delete(creditBatches).where(eq(creditBatches.id, id));
  });
}

/**
 * Check if credit batch code exists
 */
export async function creditBatchCodeExists(
  userId: string,
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await getCreditBatchByCode(userId, code);
  if (!existing) return false;
  if (excludeId && existing.id === excludeId) return false;
  return true;
}

/**
 * Get credit batches by facility ID
 */
export async function getCreditBatchesByFacilityId(
  userId: string,
  facilityId: string
): Promise<CreditBatch[]> {
  requireAuth(userId);
  return db
    .select()
    .from(creditBatches)
    .where(eq(creditBatches.facilityId, facilityId))
    .orderBy(desc(creditBatches.createdAt));
}
