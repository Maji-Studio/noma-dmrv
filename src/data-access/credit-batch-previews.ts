// Derived CO₂e-stored previews at the credit-batch grain (issue #285): the
// stored aggregate columns are gone, so every consumer (batch detail page,
// dashboard, New-Removal wizard) recomputes the same preview from member
// applications + pooled batch chemistry. Split out of credit-batches.ts to
// keep that file under the 1000-line cap; the public surface stays importable
// from "./credit-batches" via re-exports.
import { eq, inArray, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { creditBatches, type CreditBatch } from "@/db/schema/credits";
import { facilities } from "@/db/schema/facilities";
import { certifierProjects } from "@/db/schema/certification";
import { applications } from "@/db/schema/application";
import {
  DURABILITY_TIER_FALLBACK,
  type DurabilityOption,
} from "@/schemas/credit-batches";

import { requireAuth } from "./utils";
import { getChainOfCustodyData } from "./chain-of-custody";
import {
  getApplicationRollupsByBatchFromRuns,
  getProductionRunIdsByBatchId,
  type BatchApplicationRollup,
} from "./credit-batch-production-runs";
import { getCreditBatchesWithSamples } from "./credit-batch-samples";
import {
  SOIL_STORAGE_MODULE_VERSION,
  computeApplicationCo2eStored,
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

export async function getFacilityCertifierWithExecutor(
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export async function buildCo2eStoredPreview(
  userId: string,
  // The durability tier is join-derived from the facility (ADR 0021), so it is
  // supplied alongside the raw batch row rather than read off it.
  batch: Pick<
    CreditBatch,
    | "id"
    | "facilityId"
    | "meanRandomReflectancePercent"
    | "stdRandomReflectance"
    | "meanNonReactiveCarbonPercent"
    | "stdNonReactiveCarbonPercent"
  > & { durabilityOption: DurabilityOption },
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

  const appById = new Map(applicationRows.map((app) => [app.id, app]));
  const warnings: string[] = lineages.flatMap((lineage) =>
    lineage.warnings.map((warning) => `${lineage.application.code}: ${warning}`)
  );

  // Chemistry at the CREDIT-BATCH grain (issue #309): the batch's POOLED
  // replicate means — the same figures the durability data plane submits —
  // instead of run-weighted means, which don't see batch-anchored samples.
  const batchesWithSamples = await getCreditBatchesWithSamples(userId, [
    batch.id,
  ]);
  const { weightedOrganicCarbonPercent, weightedHToCorgRatio } =
    weightedBatchChemistry(batchesWithSamples);

  // The engine branches on durabilityOption: "1000_year" consumes the batch's
  // stored petrography/TGA columns (Eq.6, issue #142); the default 200-year
  // path uses per-application soil temperature + pooled H/C_org (Eq.3). An
  // unpopulated 1000-year batch degrades to the same missingInputs /
  // co2eStoredTonnes: null gap contract as 200-year gaps.
  const applicationResults = applicationIds.map((applicationId) => {
    const app = appById.get(applicationId);
    const result = computeApplicationCo2eStored({
      durabilityOption: batch.durabilityOption,
      dryMassTonnes: app?.biocharAppliedDryTons ?? null,
      soilTemperatureC: app?.soilTemperatureC ?? null,
      hToCorgRatio: weightedHToCorgRatio,
      organicCarbonPercent: weightedOrganicCarbonPercent,
      meanRandomReflectancePercent: batch.meanRandomReflectancePercent,
      stdRandomReflectance: batch.stdRandomReflectance,
      meanNonReactiveCarbonPercent: batch.meanNonReactiveCarbonPercent,
      stdNonReactiveCarbonPercent: batch.stdNonReactiveCarbonPercent,
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
  userId: string,
  batchIds: string[],
  options?: {
    // Reuse rollups the caller already computed (e.g. the New-Removal wizard
    // derives per-batch applied weight from the same map) instead of walking
    // the run membership a second time.
    applicationRollups?: Record<string, BatchApplicationRollup>;
  }
): Promise<Record<string, CreditBatchCo2eStoredPreview>> {
  requireAuth(userId);
  const ids = unique(batchIds);
  if (ids.length === 0) return {};

  const batchRows = await db
    .select({
      creditBatch: creditBatches,
      facilityDurabilityOption: facilities.durabilityOption,
    })
    .from(creditBatches)
    .leftJoin(facilities, eq(creditBatches.facilityId, facilities.id))
    .where(inArray(creditBatches.id, ids));

  // Re-attach the facility-derived tier onto each raw batch row (ADR 0021).
  const batches = batchRows.map((row) => ({
    ...row.creditBatch,
    durabilityOption: row.facilityDurabilityOption ?? DURABILITY_TIER_FALLBACK,
  }));

  const allowedIds = batches.map((batch) => batch.id);
  if (allowedIds.length === 0) return {};

  const rollupsByBatch =
    options?.applicationRollups ??
    (await getApplicationRollupsByBatchFromRuns(
      userId,
      await getProductionRunIdsByBatchId(allowedIds),
    ));

  // Bounded chunks (order-preserving) rather than one unbounded Promise.all
  // over every batch — see PREVIEW_FANOUT_CONCURRENCY.
  const previews: (readonly [string, CreditBatchCo2eStoredPreview])[] = [];
  for (let i = 0; i < batches.length; i += PREVIEW_FANOUT_CONCURRENCY) {
    const chunk = await Promise.all(
      batches.slice(i, i + PREVIEW_FANOUT_CONCURRENCY).map(async (batch) => {
        const applicationIds = rollupsByBatch[batch.id]?.applicationIds ?? [];
        return [
          batch.id,
          await buildCo2eStoredPreview(userId, batch, applicationIds),
        ] as const;
      })
    );
    previews.push(...chunk);
  }

  return Object.fromEntries(previews);
}
