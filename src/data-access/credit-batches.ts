import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  creditBatchApplications,
  type CreditBatch,
} from "@/db/schema/credits";
import { certifierProjects } from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { applications } from "@/db/schema/application";
import { deliveries } from "@/db/schema/logistics";
import type {
  CreateCreditBatchData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";

import { requireAuth } from "./utils";
import {
  gcRemovalIfOrphaned,
  removalHasBlockingSubmission,
} from "./certifier-removals";
import { getChainOfCustodyData } from "./chain-of-custody";
import { getProductionRunsWithSamples } from "./production-runs";
import { buildMassAccounting } from "@/lib/certification/mass-accounting";
import {
  SOIL_STORAGE_MODULE_VERSION,
  computeApplicationCo2eStored,
} from "@/lib/calculations/biochar-removal";
import { formatUtcDate } from "@/lib/date-utils";
import { aggregateProductionRuns } from "@/lib/isometric/utils/aggregation";
import { SafeError } from "@/lib/errors";

// ============================================
// Credit Batch Data Access Layer
// ============================================

export interface CreditBatchWithRelations extends CreditBatch {
  facility: { name: string } | null;
  applicationCount: number;
  applicationIds: string[];
  co2eStoredPreview: CreditBatchCo2eStoredPreview | null;
  previewAvailable: boolean;
}

type CreditBatchWithOptionalPreview = Omit<
  CreditBatchWithRelations,
  "co2eStoredPreview"
> & {
  co2eStoredPreview?: CreditBatchCo2eStoredPreview;
};

type CertifierProvider = (typeof certifierProjects.$inferSelect)["provider"];

export interface ApplicationCo2eStoredPreview {
  applicationId: string;
  applicationCode: string;
  co2eStoredTonnes: number | null;
  fDurable: number | null;
  organicCarbonPercent: number | null;
  effectiveSoilTemperatureC: number | null;
  missingInputs: string[];
  warnings: string[];
}

export interface CreditBatchCo2eStoredPreview {
  provider: CertifierProvider | null;
  co2eStoredTonnes: number | null;
  moduleVersion: string | null;
  applicationResults: ApplicationCo2eStoredPreview[];
  missingInputs: string[];
  warnings: string[];
}

async function getFacilityCertifierWithExecutor(
  executor: DbTransaction | typeof db,
  facilityId: string
): Promise<CertifierProvider | null> {
  const [row] = await executor
    .select({ provider: certifierProjects.provider })
    .from(certifierProjects)
    .where(eq(certifierProjects.facilityId, facilityId))
    .orderBy(
      sql`case ${certifierProjects.provider} when 'isometric' then 0 when 'puro_earth' then 1 else 2 end`
    )
    .limit(1);
  return row?.provider ?? null;
}

export async function getFacilityCertifier(
  userId: string,
  facilityId: string
): Promise<CertifierProvider | null> {
  requireAuth(userId);
  return getFacilityCertifierWithExecutor(db, facilityId);
}

async function resolveCreditBatchCertifier(
  executor: DbTransaction,
  facilityId: string
): Promise<"isometric" | null> {
  const provider = await getFacilityCertifierWithExecutor(executor, facilityId);
  if (provider && provider !== "isometric") {
    throw new SafeError(
      "Credit batches currently support only Isometric certifier mappings."
    );
  }
  return provider === "isometric" ? "isometric" : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

async function buildCo2eStoredPreview(
  userId: string,
  batch: Pick<CreditBatch, "facilityId" | "durabilityOption">,
  applicationIds: string[]
): Promise<CreditBatchCo2eStoredPreview> {
  const provider = await getFacilityCertifier(userId, batch.facilityId);
  if (provider !== "isometric") {
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: [provider ? "isometricCertifier" : "facilityCertifierProject"],
      warnings: [],
    };
  }

  if (applicationIds.length === 0) {
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: ["applicationIds"],
      warnings: [],
    };
  }

  if (batch.durabilityOption === "1000_year") {
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: ["1000YearDurabilityEngine"],
      warnings: ["1000-year CO2e stored preview is deferred to issue #142."],
    };
  }

  const [applicationRows, lineages] = await Promise.all([
    db
      .select({
        id: applications.id,
        code: applications.code,
        biocharAppliedDryTons: applications.biocharAppliedDryTons,
        soilTemperatureC: applications.soilTemperatureC,
      })
      .from(applications)
      .where(inArray(applications.id, applicationIds)),
    Promise.all(applicationIds.map((id) => getChainOfCustodyData(userId, id))),
  ]);

  const runIds = unique(
    lineages
      .map((lineage) => lineage.productionRun?.id)
      .filter((id): id is string => Boolean(id))
  );
  const runs = await getProductionRunsWithSamples(userId, runIds);
  const appById = new Map(applicationRows.map((app) => [app.id, app]));
  const warnings: string[] = lineages.flatMap((lineage) =>
    lineage.warnings.map((warning) => `${lineage.application.code}: ${warning}`)
  );

  let weightedOrganicCarbonPercent: number | null = null;
  let weightedHToCorgRatio: number | null = null;
  if (runs.length > 0) {
    const { attributionByRunId } = buildMassAccounting(lineages, runs);
    const aggregate = aggregateProductionRuns(runs, attributionByRunId);
    weightedOrganicCarbonPercent = aggregate.weightedOrganicCarbonPercent;
    weightedHToCorgRatio = aggregate.weightedHToCorgRatio;
    warnings.push(...aggregate.warnings);
  }

  const applicationResults = applicationIds.map((applicationId) => {
    const app = appById.get(applicationId);
    const result = computeApplicationCo2eStored({
      dryMassTonnes: app?.biocharAppliedDryTons ?? null,
      soilTemperatureC: app?.soilTemperatureC ?? null,
      hToCorgRatio: weightedHToCorgRatio,
      organicCarbonPercent: weightedOrganicCarbonPercent,
    });

    return {
      applicationId,
      applicationCode: app?.code ?? applicationId,
      co2eStoredTonnes: result.co2eStoredTonnes,
      fDurable: result.fDurable,
      organicCarbonPercent: result.organicCarbonPercent,
      effectiveSoilTemperatureC: result.effectiveSoilTemperatureC,
      missingInputs: result.missingInputs,
      warnings: result.warnings,
    };
  });

  const complete = applicationResults.every((r) => r.co2eStoredTonnes != null);
  const co2eStoredTonnes = complete
    ? applicationResults.reduce((sum, r) => sum + (r.co2eStoredTonnes ?? 0), 0)
    : null;

  return {
    provider,
    co2eStoredTonnes,
    moduleVersion: SOIL_STORAGE_MODULE_VERSION,
    applicationResults,
    missingInputs: unique(applicationResults.flatMap((r) => r.missingInputs)),
    warnings: [
      ...warnings,
      ...applicationResults.flatMap((r) =>
        r.warnings.map((warning) => `${r.applicationCode}: ${warning}`)
      ),
    ],
  };
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
    const startStr = typeof startDate === "string" ? startDate : formatUtcDate(startDate);
    const endStr = typeof endDate === "string" ? endDate : formatUtcDate(endDate);

    const outsideWindow = rows.filter((r) => {
      if (!r.applicationDate) return true;
      const appDateStr = formatUtcDate(r.applicationDate);
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
 * Get credit batches for a single facility, with facility info and application
 * count. Facility-scoped: credit batches belong to exactly one facility and
 * must never leak across the facility boundary.
 */
export async function getCreditBatches(
  userId: string,
  facilityId: string
): Promise<CreditBatchWithRelations[]> {
  requireAuth(userId);
  const batches = await db
    .select({
      creditBatch: creditBatches,
      facilityName: facilities.name,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(eq(creditBatches.facilityId, facilityId))
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

  return batches.map((b) => {
    const applicationIds = applicationsByBatch[b.creditBatch.id] ?? [];
    return {
      ...b.creditBatch,
      facility: b.facilityName ? { name: b.facilityName } : null,
      applicationCount: applicationIds.length,
      applicationIds,
      co2eStoredPreview: null,
      previewAvailable: false,
    };
  });
}

export async function getCo2eStoredPreviews(
  userId: string,
  batchIds: string[]
): Promise<Record<string, CreditBatchCo2eStoredPreview>> {
  requireAuth(userId);
  const ids = unique(batchIds);
  if (ids.length === 0) return {};

  const batches = await db
    .select()
    .from(creditBatches)
    .where(inArray(creditBatches.id, ids));

  const allowedIds = batches.map((batch) => batch.id);
  if (allowedIds.length === 0) return {};

  const applicationData = await db
    .select({
      creditBatchId: creditBatchApplications.creditBatchId,
      applicationId: creditBatchApplications.applicationId,
    })
    .from(creditBatchApplications)
    .where(inArray(creditBatchApplications.creditBatchId, allowedIds));

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

  const previews = await Promise.all(
    batches.map(async (batch) => {
      const applicationIds = applicationsByBatch[batch.id] ?? [];
      return [
        batch.id,
        await buildCo2eStoredPreview(userId, batch, applicationIds),
      ] as const;
    })
  );

  return Object.fromEntries(previews);
}

/**
 * Get credit batch by ID with full details
 */
export async function getCreditBatchById(
  userId: string,
  id: string
): Promise<CreditBatchWithRelations | null>;
export async function getCreditBatchById(
  userId: string,
  id: string,
  options: { skipPreview: true }
): Promise<CreditBatchWithOptionalPreview | null>;
export async function getCreditBatchById(
  userId: string,
  id: string,
  options?: { skipPreview?: boolean }
): Promise<CreditBatchWithRelations | CreditBatchWithOptionalPreview | null> {
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

  const applicationIds = applicationData.map((a) => a.applicationId);

  const result = {
    ...batch.creditBatch,
    facility: batch.facilityName ? { name: batch.facilityName } : null,
    applicationCount: applicationData.length,
    applicationIds,
    co2eStoredPreview: null,
    previewAvailable: false,
  };

  if (options?.skipPreview) {
    return result;
  }

  return {
    ...result,
    co2eStoredPreview: await buildCo2eStoredPreview(
      userId,
      batch.creditBatch,
      applicationIds
    ),
    previewAvailable: true,
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
    const certifier = await resolveCreditBatchCertifier(tx, batchData.facilityId);

    // Insert the credit batch
    const [batch] = await tx
      .insert(creditBatches)
      .values({
        code: batchData.code,
        facilityId: batchData.facilityId,
        startDate: formatUtcDate(batchData.startDate),
        endDate: formatUtcDate(batchData.endDate),
        certifier,
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
    co2eStoredPreview: await buildCo2eStoredPreview(
      userId,
      creditBatch,
      applicationIds ?? []
    ),
    previewAvailable: true,
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
    updateData.startDate = formatUtcDate(updateFields.startDate);
  if (updateFields.endDate !== undefined)
    updateData.endDate = formatUtcDate(updateFields.endDate);
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
      ? formatUtcDate(updateFields.startDate)
      : existingBatch.startDate;
    const effectiveEndDate = updateFields.endDate
      ? formatUtcDate(updateFields.endDate)
      : existingBatch.endDate;

    if (effectiveEndDate < effectiveStartDate) {
      throw new SafeError("End date must be after start date");
    }

    updateData.certifier = await resolveCreditBatchCertifier(tx, targetFacilityId);

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
    // Lock the batch so a concurrent regroup/submit can't move it mid-delete.
    const [batch] = await tx
      .select({ removalId: creditBatches.removalId })
      .from(creditBatches)
      .where(eq(creditBatches.id, id))
      .for("update")
      .limit(1);

    // Refuse to delete a batch whose removal has been sent to the certifier —
    // it would silently change what a live Isometric Removal represents.
    if (
      batch?.removalId &&
      (await removalHasBlockingSubmission(tx, batch.removalId))
    ) {
      throw new SafeError(
        "This credit batch belongs to a removal that has been submitted to the certifier. Supersede or reject that submission before deleting.",
      );
    }

    // Delete junction table links first, then the credit batch.
    await tx
      .delete(creditBatchApplications)
      .where(eq(creditBatchApplications.creditBatchId, id));
    await tx.delete(creditBatches).where(eq(creditBatches.id, id));

    // Drop the removal if this was its last member and it has no history.
    if (batch?.removalId) {
      await gcRemovalIfOrphaned(tx, batch.removalId);
    }
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
  // Defense-in-depth: getCreditBatchByCode below also enforces auth, but this
  // guard is kept intentionally so the check holds even if that call changes.
  requireAuth(userId);
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
  const startStr = formatUtcDate(startDate);
  const endStr = formatUtcDate(endDate);

  const conditions = [
    eq(creditBatches.facilityId, facilityId),
    lte(creditBatches.startDate, endStr),
    gte(creditBatches.endDate, startStr),
  ];

  if (excludeId) {
    conditions.push(sql`${creditBatches.id} != ${excludeId}`);
  }

  const [overlapping] = await db
    .select()
    .from(creditBatches)
    .where(and(...conditions))
    .limit(1);

  return overlapping ?? null;
}
