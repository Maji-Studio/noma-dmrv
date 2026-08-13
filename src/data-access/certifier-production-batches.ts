/**
 * Persistence + registry-payload facts for `certifier_production_batches`
 * (issue #630).
 *
 * The local row is the idempotency journal for the Isometric `ProductionBatch`
 * a credit batch is registered as: present ⇒ reuse `ptb_…`, absent ⇒ the
 * submission path reconciles by supplier reference before it POSTs. The remote
 * catalog stays the source of truth for the id itself.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { certifierProductionBatches } from "@/db/schema/certifier-production-batches";
import { certifierProjects } from "@/db/schema/certification";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { feedstockTypes } from "@/db/schema/feedstock";
import { productionRuns } from "@/db/schema/production";
import type { OrgContext } from "@/lib/auth/server";
import { assertSameOrg, requireOrgScope } from "./utils";

export type CertifierProductionBatchRow =
  typeof certifierProductionBatches.$inferSelect;

type CertifierProvider = CertifierProductionBatchRow["provider"];

const DEFAULT_PROVIDER: CertifierProvider = "isometric";

/**
 * The facts a `CreateProductionBatchRequest` is built from, per credit batch.
 * Nullable fields are left for the payload builder to reject with an operator
 * message rather than being filtered out silently here.
 */
export interface ProductionBatchRegistryInput {
  creditBatchId: string;
  creditBatchCode: string;
  startDate: string;
  endDate: string;
  /** Earliest physical start instant across the batch's member runs. */
  startedAt: string | null;
  /** Latest physical completion instant across the batch's member runs. */
  endedAt: string | null;
  /** Isometric project id (`prj_…`) for the batch's facility. */
  externalProjectId: string | null;
  /** Operator-pasted Isometric facility id (`fcl_…`) for the batch's facility. */
  externalFacilityId: string | null;
  /** Isometric feedstock-type id (`ftt_…`) for the batch's declared feedstock. */
  isometricFeedstockTypeId: string | null;
  /**
   * Total dry biochar mass produced by the batch's member runs (kg) —
   * `M_biochar (DM)`. Deliberately UNSCALED by application attribution: the
   * registry batch records what was produced, not what a removal claims.
   */
  totalDryMassKg: number;
  /**
   * Member runs with no `biochar_dry_mass_kg` recorded. The column is nullable,
   * so an unweighed run would otherwise shrink `M_biochar (DM)` silently — and
   * the registry has no PATCH for a production batch, so the understated figure
   * would be permanent. The caller refuses to register such a batch.
   */
  runsMissingDryMass: number;
  /** Member runs that are still open and therefore have no completion instant. */
  runsMissingEndTime: number;
}

/**
 * Load the production-batch registry facts for the given credit batches.
 * Batches absent from the DB (or from another organization) are omitted.
 */
export async function getProductionBatchRegistryInputs(
  ctx: OrgContext,
  creditBatchIds: string[],
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<ProductionBatchRegistryInput[]> {
  requireOrgScope(ctx);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];

  const batchRows = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      isometricFeedstockTypeId: feedstockTypes.isometricFeedstockTypeId,
      externalProjectId: certifierProjects.externalProjectId,
      externalFacilityId: certifierProjects.externalFacilityId,
    })
    .from(creditBatches)
    .leftJoin(
      feedstockTypes,
      and(
        eq(creditBatches.feedstockTypeId, feedstockTypes.id),
        eq(feedstockTypes.organizationId, ctx.organizationId),
      ),
    )
    .leftJoin(
      certifierProjects,
      and(
        eq(creditBatches.facilityId, certifierProjects.facilityId),
        eq(certifierProjects.provider, provider),
        eq(certifierProjects.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatches.id, ids),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    );
  if (batchRows.length === 0) return [];

  const runRows = await db
    .select({
      creditBatchId: creditBatchProductionRuns.creditBatchId,
      biocharDryMassKg: productionRuns.biocharDryMassKg,
      startTime: productionRuns.startTime,
      endTime: productionRuns.endTime,
    })
    .from(creditBatchProductionRuns)
    .innerJoin(
      productionRuns,
      and(
        eq(creditBatchProductionRuns.productionRunId, productionRuns.id),
        eq(productionRuns.organizationId, ctx.organizationId),
      ),
    )
    .where(
      and(
        inArray(creditBatchProductionRuns.creditBatchId, ids),
        eq(creditBatchProductionRuns.organizationId, ctx.organizationId),
      ),
    );

  const massByBatch = new Map<string, number>();
  const unweighedRunsByBatch = new Map<string, number>();
  const earliestStartByBatch = new Map<string, Date>();
  const latestEndByBatch = new Map<string, Date>();
  const openRunsByBatch = new Map<string, number>();
  for (const row of runRows) {
    const earliestStart = earliestStartByBatch.get(row.creditBatchId);
    if (!earliestStart || row.startTime < earliestStart) {
      earliestStartByBatch.set(row.creditBatchId, row.startTime);
    }
    if (row.endTime === null) {
      openRunsByBatch.set(
        row.creditBatchId,
        (openRunsByBatch.get(row.creditBatchId) ?? 0) + 1,
      );
    } else {
      const latestEnd = latestEndByBatch.get(row.creditBatchId);
      if (!latestEnd || row.endTime > latestEnd) {
        latestEndByBatch.set(row.creditBatchId, row.endTime);
      }
    }
    if (row.biocharDryMassKg === null) {
      unweighedRunsByBatch.set(
        row.creditBatchId,
        (unweighedRunsByBatch.get(row.creditBatchId) ?? 0) + 1,
      );
      continue;
    }
    massByBatch.set(
      row.creditBatchId,
      (massByBatch.get(row.creditBatchId) ?? 0) + row.biocharDryMassKg,
    );
  }

  return batchRows.map((batch) => ({
    creditBatchId: batch.id,
    creditBatchCode: batch.code,
    startDate: batch.startDate,
    endDate: batch.endDate,
    startedAt:
      earliestStartByBatch.get(batch.id)?.toISOString() ?? null,
    endedAt: latestEndByBatch.get(batch.id)?.toISOString() ?? null,
    externalProjectId: batch.externalProjectId,
    externalFacilityId: batch.externalFacilityId,
    isometricFeedstockTypeId: batch.isometricFeedstockTypeId,
    totalDryMassKg: massByBatch.get(batch.id) ?? 0,
    runsMissingDryMass: unweighedRunsByBatch.get(batch.id) ?? 0,
    runsMissingEndTime: openRunsByBatch.get(batch.id) ?? 0,
  }));
}

export async function getProductionBatchRegistrations(
  ctx: OrgContext,
  creditBatchIds: string[],
  provider: CertifierProvider = DEFAULT_PROVIDER,
): Promise<CertifierProductionBatchRow[]> {
  requireOrgScope(ctx);
  const ids = Array.from(new Set(creditBatchIds));
  if (ids.length === 0) return [];
  return db
    .select()
    .from(certifierProductionBatches)
    .where(
      and(
        eq(certifierProductionBatches.provider, provider),
        inArray(certifierProductionBatches.creditBatchId, ids),
        eq(certifierProductionBatches.organizationId, ctx.organizationId),
      ),
    );
}

export interface UpsertProductionBatchRegistrationInput {
  creditBatchId: string;
  externalProductionBatchId: string;
  supplierReference: string;
  externalProjectId: string | null;
  externalFacilityId: string | null;
  massKg: number;
  startedOn: string;
  endedOn: string;
  payloadHash: string;
  provider?: CertifierProvider;
}

/**
 * Persist the confirmed registry identity for a credit batch.
 *
 * The unique `(provider, credit_batch_id)` constraint resolves a concurrent
 * double submit to ONE registration, and the conflict branch deliberately does
 * NOT overwrite the identity columns: once a credit batch is registered, its
 * `ptb_…` is immutable. The returned row therefore carries the WINNER's
 * identity, which the caller compares against the id it just confirmed — a
 * mismatch is a real conflict and must fail loudly, not be papered over.
 * Mass, window and payload hash are refreshed so the local mirror keeps
 * describing the latest submitted figures.
 */
export async function upsertProductionBatchRegistration(
  ctx: OrgContext,
  input: UpsertProductionBatchRegistrationInput,
): Promise<CertifierProductionBatchRow> {
  requireOrgScope(ctx);
  await assertSameOrg(ctx, creditBatches, input.creditBatchId);
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const [row] = await db
    .insert(certifierProductionBatches)
    .values({
      organizationId: ctx.organizationId,
      provider,
      creditBatchId: input.creditBatchId,
      externalProductionBatchId: input.externalProductionBatchId,
      supplierReference: input.supplierReference,
      externalProjectId: input.externalProjectId,
      externalFacilityId: input.externalFacilityId,
      massKg: input.massKg,
      startedOn: input.startedOn,
      endedOn: input.endedOn,
      payloadHash: input.payloadHash,
    })
    .onConflictDoUpdate({
      target: [
        certifierProductionBatches.provider,
        certifierProductionBatches.creditBatchId,
      ],
      // Identity and mapping snapshot columns are intentionally absent:
      // `external_production_batch_id`, `supplier_reference`,
      // `external_project_id`, and `external_facility_id` are immutable once
      // registered.
      set: {
        massKg: sql`excluded.mass_kg`,
        startedOn: sql`excluded.started_on`,
        endedOn: sql`excluded.ended_on`,
        payloadHash: sql`excluded.payload_hash`,
        updatedAt: sql`now()`,
      },
      setWhere: eq(
        certifierProductionBatches.organizationId,
        ctx.organizationId,
      ),
    })
    .returning();
  // A false `setWhere` makes Postgres update nothing, so `RETURNING` yields no
  // row. The composite FK to `(credit_batches.id, organization_id)` makes that
  // unreachable today; the guard keeps the function from ever returning a value
  // its own signature forbids, and fails as a domain error rather than a
  // TypeError at the caller's `row.externalProductionBatchId`.
  if (!row) {
    throw new Error(
      `Production batch registration for credit batch ${input.creditBatchId} belongs to another organization`,
    );
  }
  return row;
}
