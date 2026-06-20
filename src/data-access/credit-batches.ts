import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  creditBatches,
  creditBatchProductionRuns,
  type CreditBatch,
} from "@/db/schema/credits";
import {
  certificationSubmissions,
  certifierProjects,
  certifierRemovals,
} from "@/db/schema/certification";
import { facilities } from "@/db/schema/facilities";
import { applications } from "@/db/schema/application";
import { productionRuns, samples } from "@/db/schema/production";
import type {
  CreateCreditBatchData,
  UpdateCreditBatchData,
} from "@/schemas/credit-batches";

import { requireAuth } from "./utils";
import { findOrCreateProductionProcess } from "./production-processes";
import {
  resolveSingleFeedstockType,
  validateProductionRunIds,
} from "./credit-batch-membership";
import { gcRemovalIfOrphaned } from "./certifier-removals";
import { getChainOfCustodyData } from "./chain-of-custody";
import {
  getApplicationIdsByBatchFromRuns,
  getApplicationsForRuns,
  getProductionRunIdsByBatchId,
} from "./credit-batch-production-runs";
import { assertCreditBatchProductionWindow } from "./credit-batch-production-window";
import { getProductionRunsWithSamples } from "./production-runs";
import { buildMassAccounting } from "@/lib/certification/mass-accounting";
import {
  SOIL_STORAGE_MODULE_VERSION,
  computeApplicationCo2eStored,
} from "@/lib/calculations/biochar-removal";
import { formatUtcDate } from "@/lib/date-utils";
import { aggregateProductionRuns } from "@/lib/isometric/utils/aggregation";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { BLOCKING_SUBMISSION_STATUSES } from "@/lib/certification/status";
import { SafeError } from "@/lib/errors";

export { getApplicationsForRuns } from "./credit-batch-production-runs";
export type { ApplicationForRun } from "./credit-batch-production-runs";

// ============================================
// Credit Batch Data Access Layer
// ============================================

export interface CreditBatchWithRelations extends CreditBatch {
  facility: { name: string } | null;
  applicationCount: number;
  applicationIds: string[];
  productionRunCount: number;
  productionRunIds: string[];
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
const CERTIFIER_PROVIDER = "isometric" as const;
const REMOVAL_SCOPED_SUBMISSION_TYPES = ["removal", "dataUpload"] as const;

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

export interface CreditBatchProductionRunOption {
  id: string;
  code: string;
  date: string;
  status: string;
  biocharDryMassKg: number | null;
  assignedCreditBatchId: string | null;
  assignedCreditBatchCode: string | null;
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

async function assertRemovalAllowsCreditBatchMutation(
  tx: DbTransaction,
  removalId: string | null,
  mutation: "update" | "delete",
): Promise<void> {
  if (!removalId) return;

  const [removal] = await tx
    .select({
      id: certifierRemovals.id,
      ghgStatementId: certifierRemovals.ghgStatementId,
    })
    .from(certifierRemovals)
    .where(eq(certifierRemovals.id, removalId))
    .for("update")
    .limit(1);
  if (!removal) return;

  await acquireCertificationArtifactLocksSorted(tx, [
    {
      provider: CERTIFIER_PROVIDER,
      localEntityType: "removal",
      localEntityId: removal.id,
    },
    ...(removal.ghgStatementId
      ? [
          {
            provider: CERTIFIER_PROVIDER,
            localEntityType: "ghgStatement",
            localEntityId: removal.ghgStatementId,
          },
        ]
      : []),
  ]);

  const [removalSubmission] = await tx
    .select({ id: certificationSubmissions.id })
    .from(certificationSubmissions)
    .where(
      and(
        eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
        eq(certificationSubmissions.localEntityType, "removal"),
        eq(certificationSubmissions.localEntityId, removal.id),
        inArray(
          certificationSubmissions.submissionType,
          REMOVAL_SCOPED_SUBMISSION_TYPES,
        ),
        inArray(certificationSubmissions.status, BLOCKING_SUBMISSION_STATUSES),
      ),
    )
    .limit(1);

  let ghgStatementSubmission:
    | { id: (typeof certificationSubmissions.$inferSelect)["id"] }
    | undefined;
  if (removal.ghgStatementId) {
    [ghgStatementSubmission] = await tx
      .select({ id: certificationSubmissions.id })
      .from(certificationSubmissions)
      .where(
        and(
          eq(certificationSubmissions.provider, CERTIFIER_PROVIDER),
          eq(certificationSubmissions.localEntityType, "ghgStatement"),
          eq(certificationSubmissions.submissionType, "ghg_statement"),
          eq(certificationSubmissions.localEntityId, removal.ghgStatementId),
          inArray(
            certificationSubmissions.status,
            BLOCKING_SUBMISSION_STATUSES,
          ),
        ),
      )
      .limit(1);
  }

  if (!removalSubmission && !ghgStatementSubmission) return;

  throw new SafeError(
    `Cannot ${mutation} credit batch because it is part of a submitted certification artifact. Create a correction instead of editing locked source data.`,
  );
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
    .where(and(eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)))
    .orderBy(desc(creditBatches.createdAt));

  const batchIds = batches.map((b) => b.creditBatch.id);

  if (batchIds.length === 0) {
    return [];
  }

  const productionRunIdsByBatch = await getProductionRunIdsByBatchId(batchIds);
  const applicationsByBatch = await getApplicationIdsByBatchFromRuns(
    userId,
    productionRunIdsByBatch,
  );

  return batches.map((b) => {
    const productionRunIds = productionRunIdsByBatch[b.creditBatch.id] ?? [];
    const applicationIds = applicationsByBatch[b.creditBatch.id] ?? [];
    return {
      ...b.creditBatch,
      facility: b.facilityName ? { name: b.facilityName } : null,
      applicationCount: applicationIds.length,
      applicationIds,
      productionRunCount: productionRunIds.length,
      productionRunIds,
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

  const productionRunIdsByBatch = await getProductionRunIdsByBatchId(allowedIds);
  const applicationsByBatch = await getApplicationIdsByBatchFromRuns(
    userId,
    productionRunIdsByBatch,
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

  const productionRunIdsByBatch = await getProductionRunIdsByBatchId([id]);
  const productionRunIds = productionRunIdsByBatch[id] ?? [];
  const applicationsByBatch = await getApplicationIdsByBatchFromRuns(
    userId,
    productionRunIdsByBatch,
  );
  const applicationIds = applicationsByBatch[id] ?? [];

  const result = {
    ...batch.creditBatch,
    facility: batch.facilityName ? { name: batch.facilityName } : null,
    applicationCount: applicationIds.length,
    applicationIds,
    productionRunCount: productionRunIds.length,
    productionRunIds,
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
 * Create a new credit batch with production-run membership.
 */
export async function createCreditBatch(
  userId: string,
  data: CreateCreditBatchData & { code: string }
): Promise<CreditBatchWithRelations> {
  requireAuth(userId);
  const { productionRunIds, ...batchData } = data;

  const creditBatch = await db.transaction(async (tx) => {
    const certifier = await resolveCreditBatchCertifier(tx, batchData.facilityId);
    assertCreditBatchProductionWindow(batchData.startDate, batchData.endDate);

    // ADR 0016: the credit batch is the protocol production batch (one
    // feedstock). Validate the member runs FIRST (existence, facility, window,
    // prior assignment) so a bad run ID surfaces a precise error rather than a
    // confusing "no linked feedstock" from the derivation step. Then derive the
    // single feedstock type (loud assertion on >1 type) and find-or-create the
    // (facility, feedstock) production process this batch is a <=1-month slice of.
    const runIds = productionRunIds ?? [];
    await validateProductionRunIds(
      tx,
      runIds,
      batchData.facilityId,
      batchData.startDate,
      batchData.endDate,
    );
    const feedstockTypeId = await resolveSingleFeedstockType(tx, runIds);
    const process = await findOrCreateProductionProcess(
      userId,
      { facilityId: batchData.facilityId, feedstockTypeId },
      tx,
    );

    // Insert the credit batch
    const [batch] = await tx
      .insert(creditBatches)
      .values({
        code: batchData.code,
        facilityId: batchData.facilityId,
        feedstockTypeId,
        productionProcessId: process.id,
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

    if (runIds.length > 0) {
      await tx.insert(creditBatchProductionRuns).values(
        runIds.map((productionRunId) => ({
          creditBatchId: batch.id,
          productionRunId,
        }))
      );
      // Back-fill the member runs' existing lab samples onto this batch so they
      // characterise it (ADR 0016 — both links stay populated). The per-run
      // unique constraint means these samples can't already belong elsewhere.
      await tx
        .update(samples)
        .set({ creditBatchId: batch.id, updatedAt: new Date() })
        .where(inArray(samples.productionRunId, runIds));
    }

    return batch;
  });

  // Fetch facility name
  const [facility] = await db
    .select({ name: facilities.name })
    .from(facilities)
    .where(eq(facilities.id, creditBatch.facilityId));
  const memberProductionRunIds = productionRunIds ?? [];
  const applicationIds =
    memberProductionRunIds.length > 0
      ? unique(
          (await getApplicationsForRuns(userId, memberProductionRunIds)).map(
            (row) => row.applicationId,
          ),
        )
      : [];

  return {
    ...creditBatch,
    facility: facility ?? null,
    applicationCount: applicationIds.length,
    applicationIds,
    productionRunCount: memberProductionRunIds.length,
    productionRunIds: memberProductionRunIds,
    co2eStoredPreview: await buildCo2eStoredPreview(
      userId,
      creditBatch,
      applicationIds
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
  const { productionRunIds, ...updateFields } = data;

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
        removalId: creditBatches.removalId,
      })
      .from(creditBatches)
      .where(eq(creditBatches.id, id))
      .for("update");

    if (!existingBatch) {
      throw new SafeError("Credit batch not found");
    }

    await assertRemovalAllowsCreditBatchMutation(
      tx,
      existingBatch.removalId,
      "update",
    );

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

    assertCreditBatchProductionWindow(effectiveStartDate, effectiveEndDate);

    updateData.certifier = await resolveCreditBatchCertifier(tx, targetFacilityId);

    if (productionRunIds !== undefined) {
      if (productionRunIds.length === 0) {
        throw new SafeError("A credit batch must include at least one production run.");
      }
      await validateProductionRunIds(
        tx,
        productionRunIds,
        targetFacilityId,
        effectiveStartDate,
        effectiveEndDate,
        id,
      );
    }

    let existingRunIdsForRevalidation: string[] | undefined;
    if (
      productionRunIds === undefined &&
      (facilityChanged ||
        updateFields.startDate !== undefined ||
        updateFields.endDate !== undefined)
    ) {
      const existingLinks = await tx
        .select({ productionRunId: creditBatchProductionRuns.productionRunId })
        .from(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.creditBatchId, id));
      existingRunIdsForRevalidation = existingLinks.map((l) => l.productionRunId);
      if (existingRunIdsForRevalidation.length === 0) {
        throw new SafeError("A credit batch must include at least one production run.");
      }
      await validateProductionRunIds(
        tx,
        existingRunIdsForRevalidation,
        targetFacilityId,
        effectiveStartDate,
        effectiveEndDate,
        id,
      );
    }

    // ADR 0016: re-derive the single feedstock type + production process when
    // the membership or facility changes — either can shift which (facility,
    // feedstock) process this batch belongs to. When runs are unchanged but the
    // facility moved, derive from the existing membership after validation so
    // bad run IDs/facility mismatches surface precise errors first.
    let feedstockRunIds: string[] | undefined = productionRunIds;
    if (feedstockRunIds === undefined && facilityChanged) {
      feedstockRunIds = existingRunIdsForRevalidation;
    }
    if (feedstockRunIds !== undefined) {
      const feedstockTypeId = await resolveSingleFeedstockType(tx, feedstockRunIds);
      const process = await findOrCreateProductionProcess(
        userId,
        { facilityId: targetFacilityId, feedstockTypeId },
        tx,
      );
      updateData.feedstockTypeId = feedstockTypeId;
      updateData.productionProcessId = process.id;
    }

    await tx
      .update(creditBatches)
      .set(updateData)
      .where(eq(creditBatches.id, id));

    if (productionRunIds !== undefined) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.creditBatchId, id));

      await tx.insert(creditBatchProductionRuns).values(
        productionRunIds.map((productionRunId) => ({
          creditBatchId: id,
          productionRunId,
        }))
      );

      // Re-point this batch's sample links to match the new member-run set
      // (ADR 0016): unlink samples whose run left the batch, then link the
      // current member runs' samples. The per-run unique constraint guarantees a
      // member run's samples can't already belong to another batch.
      await tx
        .update(samples)
        .set({ creditBatchId: null, updatedAt: new Date() })
        .where(eq(samples.creditBatchId, id));
      if (productionRunIds.length > 0) {
        await tx
          .update(samples)
          .set({ creditBatchId: id, updatedAt: new Date() })
          .where(inArray(samples.productionRunId, productionRunIds));
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
 * Delete a credit batch and its production-run membership links.
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

    if (!batch) {
      throw new SafeError("Credit batch not found");
    }

    await assertRemovalAllowsCreditBatchMutation(tx, batch.removalId, "delete");

    // Clear app-layer sample links, then delete membership links and the batch.
    await tx
      .update(samples)
      .set({ creditBatchId: null, updatedAt: new Date() })
      .where(eq(samples.creditBatchId, id));
    await tx
      .delete(creditBatchProductionRuns)
      .where(eq(creditBatchProductionRuns.creditBatchId, id));
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
    .where(and(eq(creditBatches.facilityId, facilityId), isNull(creditBatches.archivedAt)))
    .orderBy(desc(creditBatches.createdAt));
}

export async function getCreditBatchProductionRunOptions(
  userId: string,
  params: {
    facilityId: string;
    startDate?: string | Date | null;
    endDate?: string | Date | null;
    includeCreditBatchId?: string | null;
  },
): Promise<CreditBatchProductionRunOption[]> {
  requireAuth(userId);

  const conditions = [
    eq(productionRuns.facilityId, params.facilityId),
    isNull(productionRuns.archivedAt),
  ];

  if (params.startDate && params.endDate) {
    const { startStr, endStr } = assertCreditBatchProductionWindow(
      params.startDate,
      params.endDate,
    );
    conditions.push(gte(productionRuns.date, startStr), lte(productionRuns.date, endStr));
  }

  if (params.includeCreditBatchId) {
    const assignmentScope = or(
      isNull(creditBatchProductionRuns.creditBatchId),
      eq(creditBatchProductionRuns.creditBatchId, params.includeCreditBatchId),
    );
    if (assignmentScope) conditions.push(assignmentScope);
  }

  return db
    .select({
      id: productionRuns.id,
      code: productionRuns.code,
      date: productionRuns.date,
      status: productionRuns.status,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      assignedCreditBatchId: creditBatchProductionRuns.creditBatchId,
      assignedCreditBatchCode: creditBatches.code,
    })
    .from(productionRuns)
    .leftJoin(
      creditBatchProductionRuns,
      eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
    )
    .leftJoin(
      creditBatches,
      eq(creditBatches.id, creditBatchProductionRuns.creditBatchId),
    )
    .where(and(...conditions))
    .orderBy(desc(productionRuns.date));
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
