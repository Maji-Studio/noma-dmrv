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
import { requireOrgScope } from "./utils";

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
  for (const row of runRows) {
    massByBatch.set(
      row.creditBatchId,
      (massByBatch.get(row.creditBatchId) ?? 0) + (row.biocharDryMassKg ?? 0),
    );
  }

  return batchRows.map((batch) => ({
    creditBatchId: batch.id,
    creditBatchCode: batch.code,
    startDate: batch.startDate,
    endDate: batch.endDate,
    externalFacilityId: batch.externalFacilityId,
    isometricFeedstockTypeId: batch.isometricFeedstockTypeId,
    totalDryMassKg: massByBatch.get(batch.id) ?? 0,
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
  const provider = input.provider ?? DEFAULT_PROVIDER;
  const [row] = await db
    .insert(certifierProductionBatches)
    .values({
      organizationId: ctx.organizationId,
      provider,
      creditBatchId: input.creditBatchId,
      externalProductionBatchId: input.externalProductionBatchId,
      supplierReference: input.supplierReference,
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
      // Identity columns are intentionally absent: `external_production_batch_id`
      // and `supplier_reference` are immutable once registered.
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
  return row;
}
