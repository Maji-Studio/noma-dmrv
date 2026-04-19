import { desc, eq, inArray } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  creditBatchApplications,
  type CreditBatch,
} from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { applications } from "@/db/schema/application";
import { deliveries } from "@/db/schema/logistics";
import type {
  CreateCreditBatchData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";

import { requireAuth } from "./utils";
import { SafeError } from "@/lib/errors";

// ============================================
// Credit Batch Data Access Layer
// ============================================

export interface CreditBatchWithRelations extends CreditBatch {
  facility: { name: string } | null;
  applicationCount: number;
  applicationIds: string[];
}

/**
 * Validate that all application IDs exist and belong to the credit batch's facility.
 * Applications link to facility via: application.deliveryId → delivery.facilityId
 */
async function validateApplicationIds(
  tx: DbTransaction,
  applicationIds: string[],
  facilityId: string,
  startDate?: string | Date,
  endDate?: string | Date,
): Promise<void> {
  if (applicationIds.length === 0) return;

  // Reject duplicates
  const unique = new Set(applicationIds);
  if (unique.size !== applicationIds.length) {
    throw new SafeError("Duplicate application IDs are not allowed");
  }

  // Fetch applications with their delivery's facilityId and application date
  const rows = await tx
    .select({
      id: applications.id,
      deliveryFacilityId: deliveries.facilityId,
      applicationDate: applications.applicationDate,
    })
    .from(applications)
    .innerJoin(deliveries, eq(applications.deliveryId, deliveries.id))
    .where(inArray(applications.id, applicationIds));

  if (rows.length !== applicationIds.length) {
    const found = new Set(rows.map((r) => r.id));
    const missing = applicationIds.filter((id) => !found.has(id));
    throw new SafeError(`Application(s) not found: ${missing.join(", ")}`);
  }

  const crossFacility = rows.filter((r) => r.deliveryFacilityId !== facilityId);
  if (crossFacility.length > 0) {
    throw new SafeError(
      `Application(s) do not belong to the selected facility: ${crossFacility.map((r) => r.id).join(", ")}`
    );
  }

  // Validate application dates fall within the credit batch date window
  if (startDate != null && endDate != null) {
    const startStr = typeof startDate === "string" ? startDate : startDate.toISOString().split("T")[0];
    const endStr = typeof endDate === "string" ? endDate : endDate.toISOString().split("T")[0];

    const outsideWindow = rows.filter((r) => {
      if (!r.applicationDate) return true;
      const appDateStr = r.applicationDate.toISOString().split("T")[0];
      return appDateStr < startStr || appDateStr > endStr;
    });

    if (outsideWindow.length > 0) {
      throw new SafeError(
        `Application(s) fall outside the credit batch date window (${startStr} – ${endStr}): ${outsideWindow.map((r) => r.id).join(", ")}`
      );
    }
  }
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

  const applicationData = await db
    .select({ applicationId: creditBatchApplications.applicationId })
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
        certifier: batchData.certifier,
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

    // Validate and insert application links
    if (applicationIds && applicationIds.length > 0) {
      await validateApplicationIds(tx, applicationIds, batchData.facilityId, batchData.startDate, batchData.endDate);
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
    updateData.certifier = updateFields.certifier;
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
    // Fetch existing batch inside transaction to avoid TOCTOU race
    const [existingBatch] = await tx
      .select({
        facilityId: creditBatches.facilityId,
        startDate: creditBatches.startDate,
        endDate: creditBatches.endDate,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, id));

    if (!existingBatch) {
      throw new SafeError("Credit batch not found");
    }

    const targetFacilityId = updateFields.facilityId ?? existingBatch.facilityId;
    const facilityChanged =
      updateFields.facilityId !== undefined &&
      updateFields.facilityId !== existingBatch.facilityId;

    // Resolve the effective date window after update
    const effectiveStartDate = updateFields.startDate
      ? updateFields.startDate.toISOString().split("T")[0]
      : existingBatch.startDate;
    const effectiveEndDate = updateFields.endDate
      ? updateFields.endDate.toISOString().split("T")[0]
      : existingBatch.endDate;

    if (effectiveEndDate < effectiveStartDate) {
      throw new SafeError("End date must be after start date");
    }

    await tx
      .update(creditBatches)
      .set(updateData)
      .where(eq(creditBatches.id, id));

    if (applicationIds !== undefined) {
      // Explicit application update: validate new set against target facility
      if (applicationIds.length > 0) {
        await validateApplicationIds(tx, applicationIds, targetFacilityId, effectiveStartDate, effectiveEndDate);
      }

      await tx
        .delete(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, id));

      if (applicationIds.length > 0) {
        await tx.insert(creditBatchApplications).values(
          applicationIds.map((applicationId) => ({
            creditBatchId: id,
            applicationId,
          }))
        );
      }
    } else if (facilityChanged || updateFields.startDate !== undefined || updateFields.endDate !== undefined) {
      // Facility or dates changed but applicationIds omitted: revalidate existing links
      const existingLinks = await tx
        .select({ applicationId: creditBatchApplications.applicationId })
        .from(creditBatchApplications)
        .where(eq(creditBatchApplications.creditBatchId, id));
      const existingAppIds = existingLinks.map((l) => l.applicationId);
      if (existingAppIds.length > 0) {
        await validateApplicationIds(tx, existingAppIds, targetFacilityId, effectiveStartDate, effectiveEndDate);
      }
    }
  });

  // Fetch full details
  const result = await getCreditBatchById(userId, id);
  if (!result) {
    throw new SafeError("Failed to fetch updated credit batch");
  }
  return result;
}

/**
 * Delete a credit batch and its application links
 */
export async function deleteCreditBatch(userId: string, id: string): Promise<void> {
  requireAuth(userId);
  await db.transaction(async (tx) => {
    // Delete junction table links first
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

/**
 * Check if a date range overlaps with existing credit batches for the same facility.
 * Returns the overlapping batch if found, null otherwise.
 */
export async function checkCreditBatchDateOverlap(
  userId: string,
  facilityId: string,
  startDate: Date,
  endDate: Date,
  excludeId?: string,
): Promise<CreditBatch | null> {
  requireAuth(userId);
  const startStr = startDate.toISOString().split("T")[0];
  const endStr = endDate.toISOString().split("T")[0];

  const existing = await db
    .select()
    .from(creditBatches)
    .where(eq(creditBatches.facilityId, facilityId));

  const overlapping = existing.find((batch) => {
    if (excludeId && batch.id === excludeId) return false;
    // Overlap: startA <= endB AND endA >= startB
    return batch.startDate <= endStr && batch.endDate >= startStr;
  });

  return overlapping ?? null;
}
