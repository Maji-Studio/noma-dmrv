// Derived CO₂e-stored previews at the credit-batch grain (issue #285): the
// stored aggregate columns are gone, so every consumer (batch detail page,
// dashboard, New-Removal wizard) recomputes the same preview from member
// applications + pooled batch chemistry. Split out of credit-batches.ts to
// keep that file under the 1000-line cap; the public surface stays importable
import type { OrgContext } from "@/lib/auth/server";
// from "./credit-batches" via re-exports.
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, type CreditBatch } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { certifierProjects } from "@/db/schema/certification";
import {
  DURABILITY_TIER_FALLBACK,
  type DurabilityOption,
} from "@/schemas/credit-batches";

import { requireOrgScope } from "./utils";
import {
  loadCreditBatchLineageFacts,
  type CreditBatchLineageFacts,
} from "./credit-batch-lineage-facts";
import {
  type BatchApplicationRollup,
} from "./credit-batch-production-runs";
import { getCreditBatchesWithSamples } from "./credit-batch-samples";
import {
  SOIL_STORAGE_MODULE_VERSION,
  computeApplicationCo2eStored,
  computeApplicationCo2eStoredBlueprint1000,
  type Blueprint1000YearReplicate,
} from "@/lib/calculations/biochar-removal";
import { weightedBatchChemistry } from "@/lib/isometric/utils/durability-aggregation";

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

/**
 * Extract a 1000-year batch's COMPLETE blueprint replicates from its lab
 * Samples — total carbon + s_fraction, the exact inputs the live
 * `biochar_sequestration_1000_year` blueprint scores. The both-values filter
 * mirrors `buildDurabilityMeasurementSampleSubmissions` so the preview can
 * never see a different replicate set than the submission for the same batch.
 */
export function extract1000YearBlueprintReplicates(
  samples: Array<{
    totalCarbonPercent: number | null;
    sReflectanceFraction: number | null;
  }>,
): Blueprint1000YearReplicate[] {
  return samples.flatMap((sample) =>
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

export async function getFacilityCertifierWithExecutor(
  ctx: OrgContext,
  executor: DbTransaction | typeof db,
  facilityId: string
): Promise<CertifierProvider | null> {
  const [row] = await executor
    .select({ provider: certifierProjects.provider })
    .from(certifierProjects)
    .where(and(
      eq(certifierProjects.facilityId, facilityId),
      eq(certifierProjects.organizationId, ctx.organizationId),
    ))
    .orderBy(
      sql`case ${certifierProjects.provider} when 'isometric' then 0 when 'puro_earth' then 1 else 2 end`
    )
    .limit(1);
  return row?.provider ?? null;
}

export async function getFacilityCertifier(
  ctx: OrgContext,
  facilityId: string
): Promise<CertifierProvider | null> {
  requireOrgScope(ctx);
  return getFacilityCertifierWithExecutor(ctx, db, facilityId);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function buildCo2eStoredPreview(
  ctx: OrgContext,
  // The durability tier is join-derived from the facility (ADR 0021), so it is
  // supplied alongside the raw batch row rather than read off it.
  batch: Pick<CreditBatch, "id" | "facilityId"> & {
    durabilityOption: DurabilityOption;
  },
  applicationIds: string[],
  lineageFacts?: CreditBatchLineageFacts,
): Promise<CreditBatchCo2eStoredPreview> {
  requireOrgScope(ctx);
  const provider = await getFacilityCertifier(ctx, batch.facilityId);
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

  const facts = lineageFacts ??
    (await loadCreditBatchLineageFacts(ctx, [batch.id]))[batch.id];
  const applicationRows = facts.applications;
  const runById = new Map(facts.runs.map((run) => [run.id, run]));

  const appById = new Map(applicationRows.map((app) => [app.id, app]));
  const warnings: string[] = applicationRows.flatMap((application) => {
    const run = runById.get(application.biocharProduct.linkedProductionRunId);
    return run && run.feedstocks.length === 0
      ? [`${application.code}: The linked production run does not have any recorded feedstock allocations.`]
      : [];
  });

  // Chemistry at the CREDIT-BATCH grain (issue #309): the batch's POOLED
  // replicate means — the same figures the durability data plane submits —
  // instead of run-weighted means, which don't see batch-anchored samples.
  const batchesWithSamples = await getCreditBatchesWithSamples(ctx, [
    batch.id,
  ]);
  const { weightedOrganicCarbonPercent, weightedHToCorgRatio } =
    weightedBatchChemistry(batchesWithSamples);
  // 1000-year previews compute from the SAME blueprint inputs the registry
  // scores (per-replicate total carbon + s_fraction — see
  // `build1000YearSequestrationSample`), NOT module Eq.6 over the legacy batch
  // petrography columns: Eq.6 is a different formula from the live blueprint,
  // and those columns are never populated (issue #375 — do not "fix" the
  // preview by filling them). Sample-derived only: missing or incomplete
  // (< 3 complete replicates) evidence degrades to the null-co2e /
  // missingInputs gap contract inside the compute — never to Eq.6.
  const thousandYearReplicates =
    batch.durabilityOption === "1000_year"
      ? extract1000YearBlueprintReplicates(batchesWithSamples[0]?.samples ?? [])
      : [];

  // The preview branches on durabilityOption: "1000_year" runs the Certify
  // blueprint parity math over the batch's pooled replicates; the default
  // 200-year path uses per-application soil temperature + pooled H/C_org
  // (Eq.3). Both degrade to the same missingInputs / co2eStoredTonnes: null
  // gap contract.
  const applicationResults = applicationIds.map((applicationId) => {
    const app = appById.get(applicationId);
    const result =
      batch.durabilityOption === "1000_year"
        ? computeApplicationCo2eStoredBlueprint1000({
            dryMassTonnes: app?.biocharAppliedDryTons ?? null,
            replicates: thousandYearReplicates,
          })
        : computeApplicationCo2eStored({
            durabilityOption: batch.durabilityOption,
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

// Each preview rebuilds its batch's per-application chain-of-custody walk, so
// an unbounded Promise.all over many batches (e.g. the dashboard's "all"
// period) would burst the connection pool. Mirrors FANOUT_CONCURRENCY in
// fn/certification/certify-context-core.ts and READINESS_CONCURRENCY in
// fn/certification/overview.ts.
const PREVIEW_FANOUT_CONCURRENCY = 8;

export async function getCo2eStoredPreviews(
  ctx: OrgContext,
  batchIds: string[],
  options?: {
    // Reuse rollups the caller already computed (e.g. the New-Removal wizard
    // derives per-batch applied weight from the same map) instead of walking
    // the run membership a second time.
    applicationRollups?: Record<string, BatchApplicationRollup>;
  }
): Promise<Record<string, CreditBatchCo2eStoredPreview>> {
  requireOrgScope(ctx);
  const ids = unique(batchIds);
  if (ids.length === 0) return {};

  const batchRows = await db
    .select({
      creditBatch: creditBatches,
      facilityDurabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, and(eq(creditBatches.facilityId, facilities.id), eq(facilities.organizationId, ctx.organizationId)))
    .where(and(inArray(creditBatches.id, ids), eq(creditBatches.organizationId, ctx.organizationId)));

  // Re-attach the facility-derived tier onto each raw batch row (ADR 0021).
  const batches = batchRows.map((row) => ({
    ...row.creditBatch,
    durabilityOption: row.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK,
  }));

  const allowedIds = batches.map((batch) => batch.id);
  if (allowedIds.length === 0) return {};

  const lineageFactsByBatch = await loadCreditBatchLineageFacts(ctx, allowedIds);
  const rollupsByBatch = options?.applicationRollups ?? Object.fromEntries(
    Object.entries(lineageFactsByBatch).map(([batchId, facts]) => [batchId, {
      applicationIds: facts.applicationIds,
      appliedWeightTons: facts.appliedWeightTons,
    }]),
  );

  // Bounded chunks (order-preserving) rather than one unbounded Promise.all
  // over every batch — see PREVIEW_FANOUT_CONCURRENCY.
  const previews: (readonly [string, CreditBatchCo2eStoredPreview])[] = [];
  for (let i = 0; i < batches.length; i += PREVIEW_FANOUT_CONCURRENCY) {
    const chunk = await Promise.all(
      batches.slice(i, i + PREVIEW_FANOUT_CONCURRENCY).map(async (batch) => {
        const applicationIds = rollupsByBatch[batch.id]?.applicationIds ?? [];
        return [
          batch.id,
          await buildCo2eStoredPreview(
            ctx,
            batch,
            applicationIds,
            lineageFactsByBatch[batch.id],
          ),
        ] as const;
      })
    );
    previews.push(...chunk);
  }

  return Object.fromEntries(previews);
}
