import {
  and,
  asc,
  eq,
  exists,
  inArray,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications,
  biocharProductSourceAllocations,
  biocharProducts,
  certifierProjects,
  creditBatches,
  creditBatchProductionRuns,
  deliveries,
  facilities,
  feedstockDeliveries,
  feedstockTypes,
  feedstocks,
  formulations,
  orders,
  productionRunFeedstocks,
  productionRuns,
  reactors,
  samples,
  storageLocations,
  suppliers,
  type CreditBatch,
  type Sample,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import type { GisBoundary } from "@/lib/geojson/types";
import {
  BLUEPRINT_1000_YEAR_REPLICATES_INPUT,
  SOIL_STORAGE_MODULE_VERSION,
  SOIL_STORAGE_PREVIEW_REVERIFIED,
  computeApplicationCo2eStored,
  computeApplicationCo2eStoredBlueprint1000,
  type Blueprint1000YearReplicate,
} from "@/lib/calculations/biochar-removal";
import { MINIMUM_REPLICATES_PER_BATCH } from "@/lib/calculations/biochar-eligibility";
import { SafeError } from "@/lib/errors";
import {
  weightedBatchChemistry,
  type WeightedBatchChemistry,
} from "@/lib/isometric/utils/durability-aggregation";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "@/lib/certification/preview-gaps";
import {
  DURABILITY_TIER_FALLBACK,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import {
  splitApplicationAcrossSourceAllocations,
  type ProductSourceAllocationFact,
} from "./biochar-product-application-allocation";
import { productionRunDateExpr } from "./production-runs/date-expr";
import { requireOrgScope } from "./utils";

type Executor = DbTransaction | typeof db;

export interface BatchLineageFeedstockFact {
  id: string;
  code: string;
  status: string | null;
  deliveryDate: Date | null;
  massDryKg: number | null;
  massUsedKg: number | null;
  eligibilityStatus: "eligible" | "ineligible" | "conditional" | null;
  supplierName: string | null;
  feedstockTypeName: string | null;
  feedstockDeliveryCode: string | null;
}

export interface BatchLineageRunFact {
  id: string;
  code: string;
  status: string | null;
  date: Date | string;
  biocharStorageName?: string | null;
  biocharOutputKg?: number | null;
  biocharDryMassKg: number | null;
  feedstockMassDryKg: number | null;
  reactor: {
    id: string;
    code: string;
    identifier: string;
    reactorType: string | null;
  } | null;
  feedstocks: BatchLineageFeedstockFact[];
}

export interface BatchLineageApplicationFact {
  id: string;
  code: string;
  status: string | null;
  applicationDate: Date;
  fieldIdentifier: string | null;
  evidenceMethod: "visual" | "boundary";
  gisBoundary: GisBoundary | null;
  biocharAppliedTons: number;
  biocharAppliedDryTons: number | null;
  sourceAllocation: ProductSourceAllocationFact | null;
  soilTemperatureC: number | null;
  facility: { id: string; code: string; name: string };
  delivery: {
    id: string;
    code: string;
    status: string | null;
    deliveryDate: Date;
    deliveredWetMassKg?: number | null;
    massDryKg: number | null;
  };
  order: {
    id: string;
    code: string;
    orderDate: Date;
    quantityKg: number | null;
  } | null;
  biocharProduct: {
    id: string;
    code: string;
    status: string | null;
    productionDate: Date;
    massKg: number | null;
    moistureContentPercent: number | null;
    formulationName: string | null;
    linkedProductionRunId: string;
  };
}

export interface CreditBatchLineageFacts {
  batchId: string;
  productionRunIds: string[];
  runs: BatchLineageRunFact[];
  applications: BatchLineageApplicationFact[];
  applicationIds: string[];
  appliedWeightTons: number;
}

export type CertifierProvider =
  (typeof certifierProjects.$inferSelect)["provider"];

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

interface CreditBatchChemistry extends WeightedBatchChemistry {
  blueprint1000YearReplicates: Blueprint1000YearReplicate[];
}

export interface CreditBatchRollup {
  batch: CreditBatch & { durabilityOption: DurabilityOption };
  lineageFacts: CreditBatchLineageFacts;
  appliedWeightTons: number;
}

export interface CreditBatchAccounting extends CreditBatchRollup {
  co2ePreview: CreditBatchCo2eStoredPreview;
}

export type CreditBatchRollupsByBatch = Record<string, CreditBatchRollup>;
export type CreditBatchAccountingByBatch = Record<
  string,
  CreditBatchAccounting
>;

const uniqueSorted = (values: string[]) => [...new Set(values)].sort();
const unique = (values: string[]) => [...new Set(values)];

/** Four set-based queries regardless of batch/application count. */
async function loadLineageWithExecutor(
  ctx: OrgContext,
  batchIds: string[],
  executor: Executor,
): Promise<Record<string, CreditBatchLineageFacts>> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(batchIds);
  if (ids.length === 0) return {};

  const membershipRows = await executor
    .select({
      batchId: creditBatchProductionRuns.creditBatchId,
      runId: productionRuns.id,
      runCode: productionRuns.code,
      runStatus: productionRuns.status,
      runDate: productionRunDateExpr(),
      biocharStorageName: storageLocations.name,
      biocharOutputKg: productionRuns.biocharOutputKg,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      feedstockMassDryKg: productionRuns.feedstockMassDryKg,
      reactorId: reactors.id,
      reactorCode: reactors.code,
      reactorIdentifier: reactors.identifier,
      reactorType: reactors.reactorType,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      productionRuns,
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      reactors,
      and(
        eq(productionRuns.reactorId, reactors.id),
        eq(reactors.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      storageLocations,
      and(
        eq(productionRuns.biocharStorageLocationId, storageLocations.id),
        eq(storageLocations.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatchProductionRuns.creditBatchId, ids),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    );

  const runIds = uniqueSorted(membershipRows.map((row) => row.runId));
  const allocationForMemberRun = executor
    .select({ value: sql`1` })
    .from(biocharProductSourceAllocations)
    .where(
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
        inArray(
          biocharProductSourceAllocations.productionRunId,
          runIds,
        ),
      ),
    );
  const anySourceAllocation = executor
    .select({ value: sql`1` })
    .from(biocharProductSourceAllocations)
    .where(
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
      ),
    );
  const applicationRows = runIds.length
    ? await executor
        .select({
          id: applications.id,
          code: applications.code,
          status: applications.status,
          applicationDate: applications.applicationDate,
          fieldIdentifier: applications.fieldIdentifier,
          evidenceMethod: applications.evidenceMethod,
          gisBoundary: applications.gisBoundary,
          biocharAppliedTons: applications.biocharAppliedTons,
          biocharAppliedDryTons: applications.biocharAppliedDryTons,
          soilTemperatureC: applications.soilTemperatureC,
          facilityId: facilities.id,
          facilityCode: facilities.code,
          facilityName: facilities.name,
          deliveryId: deliveries.id,
          deliveryCode: deliveries.code,
          deliveryStatus: deliveries.status,
          deliveryDate: deliveries.deliveryDate,
          deliveryWetMassKg: deliveries.deliveredWetMassKg,
          deliveryMassDryKg: deliveries.massDryKg,
          orderId: orders.id,
          orderCode: orders.code,
          orderDate: orders.orderDate,
          orderQuantityKg: orders.quantityKg,
          productId: biocharProducts.id,
          productCode: biocharProducts.code,
          productStatus: biocharProducts.status,
          productionDate: biocharProducts.productionDate,
          productMassKg: biocharProducts.massKg,
          productMoisturePercent: biocharProducts.moistureContentPercent,
          formulationName: formulations.name,
          linkedProductionRunId: biocharProducts.linkedProductionRunId,
        })
        .from(applications)
        .innerJoin(
          deliveries,
          and(
            eq(applications.deliveryId, deliveries.id),
            eq(deliveries.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(
          orders,
          and(
            eq(deliveries.orderId, orders.id),
            eq(orders.organizationId, ctx.organizationId),
          ),
        )
        .innerJoin(
          biocharProducts,
          and(
            sql`${biocharProducts.id} = coalesce(${deliveries.biocharProductId}, ${orders.biocharProductId})`,
            eq(biocharProducts.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(
          formulations,
          and(
            eq(biocharProducts.formulationId, formulations.id),
            eq(formulations.organizationId, ctx.organizationId),
          ),
        )
        .innerJoin(
          facilities,
          and(
            eq(deliveries.facilityId, facilities.id),
            eq(facilities.organizationId, ctx.organizationId),
          ),
        )
        .where(
          and(
            or(
              exists(allocationForMemberRun),
              and(
                notExists(anySourceAllocation),
                inArray(biocharProducts.linkedProductionRunId, runIds),
              ),
            ),
            eq(applications.organizationId, ctx.organizationId),
          ),
        )
    : [];

  const productIds = uniqueSorted(
    applicationRows.map((row) => row.productId),
  );
  const sourceAllocationRows = productIds.length
    ? await executor
        .select({
          biocharProductId:
            biocharProductSourceAllocations.biocharProductId,
          productionRunId:
            biocharProductSourceAllocations.productionRunId,
          allocatedWetMassKg:
            biocharProductSourceAllocations.allocatedWetMassKg,
          allocatedDryMassKg:
            biocharProductSourceAllocations.allocatedDryMassKg,
        })
        .from(biocharProductSourceAllocations)
        .where(
          and(
            inArray(
              biocharProductSourceAllocations.biocharProductId,
              productIds,
            ),
            eq(
              biocharProductSourceAllocations.organizationId,
              ctx.organizationId,
            ),
          ),
        )
        .orderBy(
          asc(biocharProductSourceAllocations.biocharProductId),
          asc(biocharProductSourceAllocations.productionRunId),
        )
    : [];

  const feedstockRows = runIds.length
    ? await executor
        .select({
          runId: productionRunFeedstocks.productionRunId,
          id: feedstocks.id,
          code: feedstocks.code,
          status: feedstocks.status,
          deliveryDate: feedstocks.deliveryDate,
          massDryKg: feedstocks.massDryKg,
          massUsedKg: productionRunFeedstocks.massUsedKg,
          eligibilityStatus: feedstocks.eligibilityStatus,
          supplierName: suppliers.name,
          feedstockTypeName: feedstockTypes.name,
          feedstockDeliveryCode: feedstockDeliveries.code,
        })
        .from(productionRunFeedstocks)
        .innerJoin(
          feedstocks,
          and(
            eq(productionRunFeedstocks.feedstockId, feedstocks.id),
            eq(feedstocks.organizationId, ctx.organizationId),
          ),
        )
        .leftJoin(feedstockDeliveries, and(eq(feedstocks.feedstockDeliveryId, feedstockDeliveries.id), eq(feedstockDeliveries.organizationId, ctx.organizationId)))
        .leftJoin(suppliers, and(eq(feedstocks.supplierId, suppliers.id), eq(suppliers.organizationId, ctx.organizationId)))
        .leftJoin(feedstockTypes, and(eq(feedstocks.feedstockTypeId, feedstockTypes.id), eq(feedstockTypes.organizationId, ctx.organizationId)))
        .where(and(inArray(productionRunFeedstocks.productionRunId, runIds), eq(productionRunFeedstocks.organizationId, ctx.organizationId)))
    : [];

  const feedstocksByRun = new Map<string, BatchLineageFeedstockFact[]>();
  for (const row of feedstockRows) {
    const facts = feedstocksByRun.get(row.runId) ?? [];
    facts.push({ ...row });
    feedstocksByRun.set(row.runId, facts);
  }
  const runById = new Map<string, BatchLineageRunFact>();
  for (const row of membershipRows) {
    if (runById.has(row.runId)) continue;
    runById.set(row.runId, {
      id: row.runId,
      code: row.runCode,
      status: row.runStatus,
      date: row.runDate,
      biocharStorageName: row.biocharStorageName,
      biocharOutputKg: row.biocharOutputKg,
      biocharDryMassKg: row.biocharDryMassKg,
      feedstockMassDryKg: row.feedstockMassDryKg,
      reactor: row.reactorId
        ? { id: row.reactorId, code: row.reactorCode!, identifier: row.reactorIdentifier!, reactorType: row.reactorType }
        : null,
      feedstocks: (feedstocksByRun.get(row.runId) ?? []).sort((a, b) => a.id.localeCompare(b.id)),
    });
  }

  const allocationsByProductId = new Map<
    string,
    ProductSourceAllocationFact[]
  >();
  for (const row of sourceAllocationRows) {
    const allocations =
      allocationsByProductId.get(row.biocharProductId) ?? [];
    allocations.push({
      productionRunId: row.productionRunId,
      allocatedWetMassKg: row.allocatedWetMassKg,
      allocatedDryMassKg: row.allocatedDryMassKg,
    });
    allocationsByProductId.set(row.biocharProductId, allocations);
  }

  const applicationsByRun = new Map<string, BatchLineageApplicationFact[]>();
  for (const row of applicationRows) {
    const sourceAllocations =
      allocationsByProductId.get(row.productId) ?? [];
    const effectiveRunId =
      sourceAllocations[0]?.productionRunId ??
      row.linkedProductionRunId;
    if (!effectiveRunId) {
      throw new SafeError(
        `Application ${row.code} has no linked production run. Link a production run before certifying it.`,
      );
    }
    const application: BatchLineageApplicationFact = {
      id: row.id, code: row.code, status: row.status,
      applicationDate: row.applicationDate, fieldIdentifier: row.fieldIdentifier,
      evidenceMethod: row.evidenceMethod,
      gisBoundary: row.gisBoundary,
      biocharAppliedTons: row.biocharAppliedTons,
      biocharAppliedDryTons: row.biocharAppliedDryTons,
      sourceAllocation: null,
      soilTemperatureC: row.soilTemperatureC,
      facility: { id: row.facilityId, code: row.facilityCode, name: row.facilityName },
      delivery: { id: row.deliveryId, code: row.deliveryCode, status: row.deliveryStatus, deliveryDate: row.deliveryDate, deliveredWetMassKg: row.deliveryWetMassKg, massDryKg: row.deliveryMassDryKg },
      order: row.orderId ? { id: row.orderId, code: row.orderCode!, orderDate: row.orderDate!, quantityKg: row.orderQuantityKg } : null,
      biocharProduct: { id: row.productId, code: row.productCode, status: row.productStatus, productionDate: row.productionDate, massKg: row.productMassKg, moistureContentPercent: row.productMoisturePercent, formulationName: row.formulationName, linkedProductionRunId: effectiveRunId },
    };
    for (const slice of splitApplicationAcrossSourceAllocations(
      application,
      sourceAllocations,
    )) {
      const runId = slice.biocharProduct.linkedProductionRunId;
      const facts = applicationsByRun.get(runId) ?? [];
      facts.push(slice);
      applicationsByRun.set(runId, facts);
    }
  }

  const runIdsByBatch = new Map<string, string[]>();
  for (const row of membershipRows) {
    const runIds = runIdsByBatch.get(row.batchId) ?? [];
    runIds.push(row.runId);
    runIdsByBatch.set(row.batchId, runIds);
  }

  return Object.fromEntries(ids.map((batchId) => {
    const productionRunIds = uniqueSorted(runIdsByBatch.get(batchId) ?? []);
    const applications = Array.from(
      new Map(
        productionRunIds
          .flatMap((runId) => applicationsByRun.get(runId) ?? [])
          .map((app) => [
            `${app.id}:${app.biocharProduct.linkedProductionRunId}`,
            app,
          ]),
      ).values(),
    ).sort((left, right) =>
      left.id.localeCompare(right.id) ||
      left.biocharProduct.linkedProductionRunId.localeCompare(
        right.biocharProduct.linkedProductionRunId,
      ),
    );
    const applicationIds = uniqueSorted(
      applications.map((application) => application.id),
    );
    return [batchId, {
      batchId,
      productionRunIds,
      runs: productionRunIds.map((runId) => runById.get(runId)).filter((run): run is BatchLineageRunFact => !!run),
      applications,
      applicationIds,
      appliedWeightTons: applications.reduce((total, app) => total + app.biocharAppliedTons, 0),
    }];
  }));
}

/**
 * Extract a 1000-year batch's complete blueprint replicates from its lab
 * Samples. The both-values filter mirrors the registry submission builder.
 */
export function extract1000YearBlueprintReplicates(
  batchSamples: Array<{
    totalCarbonPercent: number | null;
    sReflectanceFraction: number | null;
  }>,
): Blueprint1000YearReplicate[] {
  return batchSamples.flatMap((sample) =>
    sample.totalCarbonPercent == null || sample.sReflectanceFraction == null
      ? []
      : [
          {
            totalCarbonPercent: sample.totalCarbonPercent,
            sReflectanceFraction: sample.sReflectanceFraction,
          },
        ],
  );
}

/**
 * Batch-level evidence gaps that remain true even when there is no application
 * mass to calculate. Method-B batches intentionally carry no current-batch
 * sample requirement.
 */
export function independentPreviewMissingInputs(
  batch: Pick<CreditBatch, "sampling"> & {
    durabilityOption: DurabilityOption;
  },
  batchSamples: Array<{
    totalCarbonPercent: number | null;
    sReflectanceFraction: number | null;
  }>,
): string[] {
  if (
    batch.sampling === "sampled" &&
    batch.durabilityOption === "1000_year" &&
    extract1000YearBlueprintReplicates(batchSamples).length <
      MINIMUM_REPLICATES_PER_BATCH
  ) {
    return [BLUEPRINT_1000_YEAR_REPLICATES_INPUT];
  }
  return [];
}

function buildCo2eStoredPreview(
  batch: CreditBatch & { durabilityOption: DurabilityOption },
  provider: CertifierProvider | null,
  facts: CreditBatchLineageFacts,
  chemistry: CreditBatchChemistry,
): CreditBatchCo2eStoredPreview {
  if (provider !== "isometric") {
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: [
        provider ? "isometricCertifier" : "facilityCertifierProject",
      ],
      warnings: [],
    };
  }

  if (!SOIL_STORAGE_PREVIEW_REVERIFIED) {
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: [STORED_CO2E_PREVIEW_REVERIFICATION_GAP],
      warnings: [],
    };
  }

  if (facts.applicationIds.length === 0) {
    const independentMissingInputs = independentPreviewMissingInputs(
      batch,
      chemistry.blueprint1000YearReplicates,
    );
    return {
      provider,
      co2eStoredTonnes: null,
      moduleVersion: null,
      applicationResults: [],
      missingInputs: ["applicationIds", ...independentMissingInputs],
      warnings: [],
    };
  }

  const runById = new Map(facts.runs.map((run) => [run.id, run]));
  const applicationSlicesById = new Map<
    string,
    BatchLineageApplicationFact[]
  >();
  for (const application of facts.applications) {
    const slices = applicationSlicesById.get(application.id) ?? [];
    slices.push(application);
    applicationSlicesById.set(application.id, slices);
  }
  const appById = new Map(
    Array.from(applicationSlicesById, ([applicationId, slices]) => {
      const [first] = slices;
      if (!first) return [applicationId, undefined] as const;
      const hasUnknownDryMass = slices.some(
        (slice) => slice.biocharAppliedDryTons == null,
      );
      return [
        applicationId,
        {
          ...first,
          biocharAppliedTons: slices.reduce(
            (sum, slice) => sum + slice.biocharAppliedTons,
            0,
          ),
          biocharAppliedDryTons: hasUnknownDryMass
            ? null
            : slices.reduce(
                (sum, slice) =>
                  sum + (slice.biocharAppliedDryTons ?? 0),
                0,
              ),
        },
      ] as const;
    }),
  );
  const lineageWarnings = facts.applications.flatMap((application) => {
    const run = runById.get(
      application.biocharProduct.linkedProductionRunId,
    );
    return run && run.feedstocks.length === 0
      ? [
          `${application.code}: The linked production run does not have any recorded feedstock allocations.`,
        ]
      : [];
  });

  const applicationResults = facts.applicationIds.map((applicationId) => {
    const application = appById.get(applicationId);
    const result =
      batch.durabilityOption === "1000_year"
        ? computeApplicationCo2eStoredBlueprint1000({
            dryMassTonnes: application?.biocharAppliedDryTons ?? null,
            replicates: chemistry.blueprint1000YearReplicates,
          })
        : computeApplicationCo2eStored({
            durabilityOption: batch.durabilityOption,
            dryMassTonnes: application?.biocharAppliedDryTons ?? null,
            soilTemperatureC: application?.soilTemperatureC ?? null,
            hToCorgRatio: chemistry.weightedHToCorgRatio,
            organicCarbonPercent: chemistry.weightedOrganicCarbonPercent,
          });

    return {
      applicationId,
      applicationCode: application?.code ?? applicationId,
      co2eStoredTonnes: result.co2eStoredTonnes,
      fDurable: result.fDurable,
      organicCarbonPercent: result.organicCarbonPercent,
      effectiveSoilTemperatureC: result.effectiveSoilTemperatureC,
      missingInputs: result.missingInputs,
      warnings: result.warnings,
    };
  });

  const complete = applicationResults.every(
    (result) => result.co2eStoredTonnes != null,
  );
  return {
    provider,
    co2eStoredTonnes: complete
      ? applicationResults.reduce(
          (sum, result) => sum + (result.co2eStoredTonnes ?? 0),
          0,
        )
      : null,
    moduleVersion: SOIL_STORAGE_MODULE_VERSION,
    applicationResults,
    missingInputs: unique(
      applicationResults.flatMap((result) => result.missingInputs),
    ),
    warnings: [
      ...unique(lineageWarnings),
      ...applicationResults.flatMap((result) =>
        result.warnings.map(
          (warning) => `${result.applicationCode}: ${warning}`,
        ),
      ),
    ],
  };
}

async function loadFacilityCertifiers(
  ctx: OrgContext,
  executor: Executor,
  facilityIds: string[],
): Promise<Map<string, CertifierProvider>> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(facilityIds);
  if (ids.length === 0) return new Map();

  const rows = await executor
    .select({
      facilityId: certifierProjects.facilityId,
      provider: certifierProjects.provider,
    })
    .from(certifierProjects)
    .where(
      and(
        inArray(certifierProjects.facilityId, ids),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(
      asc(certifierProjects.facilityId),
      sql`case ${certifierProjects.provider} when 'isometric' then 0 when 'puro_earth' then 1 else 2 end`,
    );

  const providers = new Map<string, CertifierProvider>();
  for (const row of rows) {
    if (!providers.has(row.facilityId)) {
      providers.set(row.facilityId, row.provider);
    }
  }
  return providers;
}

export async function getFacilityCertifierWithExecutor(
  ctx: OrgContext,
  executor: Executor,
  facilityId: string,
): Promise<CertifierProvider | null> {
  requireOrgScope(ctx);
  return (
    (await loadFacilityCertifiers(ctx, executor, [facilityId])).get(
      facilityId,
    ) ?? null
  );
}

export async function getFacilityCertifier(
  ctx: OrgContext,
  facilityId: string,
): Promise<CertifierProvider | null> {
  requireOrgScope(ctx);
  return getFacilityCertifierWithExecutor(ctx, db, facilityId);
}

async function loadCreditBatchRollupsWithExecutor(
  ctx: OrgContext,
  batchIds: string[],
  executor: Executor,
): Promise<CreditBatchRollupsByBatch> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(batchIds);
  if (ids.length === 0) return {};

  const batchRows = await executor
    .select({
      creditBatch: creditBatches,
      facilityDurabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(
      facilities,
      and(
        eq(creditBatches.facilityId, facilities.id),
        eq(facilities.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatches.id, ids),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    );

  const batchById = new Map(
    batchRows.map((row) => [
      row.creditBatch.id,
      {
        ...row.creditBatch,
        durabilityOption:
          row.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK,
      },
    ]),
  );
  const batches = ids.flatMap((id) => {
    const batch = batchById.get(id);
    return batch ? [batch] : [];
  });
  const allowedIds = batches.map((batch) => batch.id);
  if (allowedIds.length === 0) return {};

  const factsByBatch = await loadLineageWithExecutor(
    ctx,
    allowedIds,
    executor,
  );
  return Object.fromEntries(
    batches.map((batch) => {
      const lineageFacts = factsByBatch[batch.id];
      return [
        batch.id,
        {
          batch,
          lineageFacts,
          appliedWeightTons: lineageFacts.appliedWeightTons,
        },
      ];
    }),
  );
}

/**
 * Set-based batch identity + lineage rollups without sample chemistry or CO₂e
 * preview assembly. Shallow list and guard callers use this projection so the
 * deep module still owns the walk without paying for data they discard.
 */
export async function loadCreditBatchRollups(
  ctx: OrgContext,
  batchIds: string[],
): Promise<CreditBatchRollupsByBatch> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(batchIds);
  if (ids.length === 0) return {};
  return db.transaction((tx) =>
    loadCreditBatchRollupsWithExecutor(ctx, ids, tx),
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    },
  );
}

/**
 * Deep, set-based credit-batch accounting read. This is the only full preview
 * assembly: callers ask for complete accounting records and never preload or
 * thread facts back into another public query.
 */
export async function loadCreditBatchAccounting(
  ctx: OrgContext,
  batchIds: string[],
): Promise<CreditBatchAccountingByBatch> {
  requireOrgScope(ctx);
  const ids = uniqueSorted(batchIds);
  if (ids.length === 0) return {};

  return db.transaction(
    async (tx) => {
      const rollupsByBatch = await loadCreditBatchRollupsWithExecutor(
        ctx,
        ids,
        tx,
      );
      const rollups = ids.flatMap((id) => {
        const rollup = rollupsByBatch[id];
        return rollup ? [rollup] : [];
      });
      const allowedIds = rollups.map(({ batch }) => batch.id);
      if (allowedIds.length === 0) return {};

      const sampleRows = await tx
        .select()
        .from(samples)
        .where(
          and(
            inArray(samples.creditBatchId, allowedIds),
            eq(samples.organizationId, ctx.organizationId),
          ),
        )
        .orderBy(asc(samples.id));
      const samplesByBatch = new Map<string, Sample[]>();
      for (const sample of sampleRows) {
        if (!sample.creditBatchId) continue;
        const batchSamples = samplesByBatch.get(sample.creditBatchId) ?? [];
        batchSamples.push(sample);
        samplesByBatch.set(sample.creditBatchId, batchSamples);
      }
      const providersByFacility = await loadFacilityCertifiers(
        ctx,
        tx,
        rollups.map(({ batch }) => batch.facilityId),
      );

      return Object.fromEntries(
        rollups.map((rollup) => {
          const { batch, lineageFacts } = rollup;
          const batchSamples = samplesByBatch.get(batch.id) ?? [];
          const weightedChemistry = weightedBatchChemistry([
            {
              creditBatchId: batch.id,
              creditBatchCode: batch.code,
              samples: batchSamples,
              runs: lineageFacts.runs.map((run) => ({
                id: run.id,
                biocharDryMassKg: run.biocharDryMassKg,
              })),
            },
          ]);
          const chemistry: CreditBatchChemistry = {
            ...weightedChemistry,
            blueprint1000YearReplicates:
              batch.durabilityOption === "1000_year"
                ? extract1000YearBlueprintReplicates(batchSamples)
                : [],
          };
          const provider = providersByFacility.get(batch.facilityId) ?? null;
          return [
            batch.id,
            {
              ...rollup,
              co2ePreview: buildCo2eStoredPreview(
                batch,
                provider,
                lineageFacts,
                chemistry,
              ),
            },
          ];
        }),
      );
    },
    {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    },
  );
}

/** Compatibility preview read backed exclusively by the deep accounting seam. */
export async function getCo2eStoredPreviews(
  ctx: OrgContext,
  batchIds: string[],
): Promise<Record<string, CreditBatchCo2eStoredPreview>> {
  requireOrgScope(ctx);
  const accountingByBatch = await loadCreditBatchAccounting(ctx, batchIds);
  return Object.fromEntries(
    Object.entries(accountingByBatch).map(([batchId, accounting]) => [
      batchId,
      accounting.co2ePreview,
    ]),
  );
}
