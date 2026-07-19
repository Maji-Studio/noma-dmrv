/**
 * Chain of custody — credit-batch roll-up (chain-of-custody views Phase 3).
 *
 * Re-anchors the chain-of-custody page on the credit batch (ADR 0011): the
 * batch roll-up is its member applications' rollbacks merged, runs deduped —
 * resolved from the shared set-based lineage facts.
 * The Sankey aggregates come from the same payload via the pure
 * `buildBatchSankey` builder; the geo roll-up merges the per-application
 * Phase 2 geo payloads so the Carbon Transit map renders unchanged.
 */
import { and, eq } from "drizzle-orm";
import type { OrgContext } from "@/lib/auth/server";
import { db } from "@/db";
import { creditBatches, facilities } from "@/db/schema";
import {
  buildBatchSankey,
  type CreditBatchSankeyData,
} from "@/lib/chain-of-custody/sankey";
import { SafeError } from "@/lib/errors";
import {
  projectChainOfCustodyFromBatchFacts,
  type ChainFacility,
  type ChainOfCustodyData,
} from "./chain-of-custody";
import {
  projectChainOfCustodyGeoData,
  type ChainGeoLeg,
  type ChainGeoNode,
  type ChainOfCustodyGeoData,
} from "./chain-of-custody-geo";
import { loadCreditBatchLineageFacts } from "./credit-batch-lineage-facts";
import { requireOrgScope } from "./utils";

export interface CreditBatchChainBatch {
  id: string;
  code: string;
  status: string | null;
  startDate: string;
  endDate: string;
}

export interface CreditBatchChainLineage {
  applicationId: string;
  chain: ChainOfCustodyData;
}

export interface CreditBatchChainData {
  batch: CreditBatchChainBatch;
  facility: ChainFacility;
  /** One resolved rollback per member application (DAG merge happens client-side). */
  lineages: CreditBatchChainLineage[];
  sankey: CreditBatchSankeyData;
  warnings: string[];
}

interface ResolvedBatchScope {
  batch: CreditBatchChainBatch & { facilityId: string };
  applicationIds: string[];
  lineages: CreditBatchChainLineage[];
}

// The roll-up's lineage walk — shared by the chain and geo payloads. The
// This page only needs the batch identity fields below; loading the full batch
// detail would resolve the same lineage facts a second time.
async function resolveBatchScope(
  ctx: OrgContext,
  creditBatchId: string,
): Promise<ResolvedBatchScope> {
  const [batch] = await db
    .select({
      id: creditBatches.id,
      code: creditBatches.code,
      status: creditBatches.status,
      startDate: creditBatches.startDate,
      endDate: creditBatches.endDate,
      facilityId: creditBatches.facilityId,
    })
    .from(creditBatches)
    .where(
      and(
        eq(creditBatches.id, creditBatchId),
        eq(creditBatches.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!batch) {
    throw new SafeError("Credit batch not found");
  }

  const facts = (await loadCreditBatchLineageFacts(ctx, [creditBatchId]))[
    creditBatchId
  ];
  const runById = new Map(facts.runs.map((run) => [run.id, run]));
  const lineages = facts.applications.map((application) => ({
    applicationId: application.id,
    chain: projectChainOfCustodyFromBatchFacts(
      application,
      runById.get(application.biocharProduct.linkedProductionRunId)!,
    ),
  }));
  const applicationIds = facts.applicationIds;
  return { batch, applicationIds, lineages };
}

// Lineage warnings merged batch-wide, prefixed by the application they belong
// to so a missing link in one member is attributable at roll-up scale.
function mergeLineageWarnings(lineages: CreditBatchChainLineage[]): string[] {
  const merged: string[] = [];
  for (const { chain } of lineages) {
    for (const warning of chain.warnings) {
      merged.push(`${chain.application.code}: ${warning}`);
    }
  }
  return Array.from(new Set(merged));
}

export async function getCreditBatchChainData(
  ctx: OrgContext,
  creditBatchId: string,
): Promise<CreditBatchChainData> {
  requireOrgScope(ctx);

  const { batch, lineages } = await resolveBatchScope(ctx, creditBatchId);

  const warnings = mergeLineageWarnings(lineages);
  if (lineages.length === 0) {
    warnings.push("This credit batch has no member applications yet.");
  }

  const sankey = buildBatchSankey(lineages.map(({ chain }) => chain));

  return {
    batch: {
      id: batch.id,
      code: batch.code,
      status: batch.status,
      startDate: batch.startDate,
      endDate: batch.endDate,
    },
    facility:
      lineages[0]?.chain.facility ?? (await getFacilityIdentity(ctx, batch.facilityId)),
    lineages,
    sankey,
    warnings,
  };
}

/**
 * Geo roll-up: the member applications' Phase 2 geo payloads merged into one
 * `ChainOfCustodyGeoData` — nodes and legs deduped by id (shared runs / lots /
 * feedstocks collapse), warnings deduped — so the Carbon Transit map consumes
 * the batch exactly like a single application.
 */
export async function getCreditBatchChainGeoData(
  ctx: OrgContext,
  creditBatchId: string,
): Promise<ChainOfCustodyGeoData> {
  requireOrgScope(ctx);

  const { batch, lineages } = await resolveBatchScope(
    ctx,
    creditBatchId,
  );

  const payloads = await Promise.all(
    lineages.map(({ chain }) => projectChainOfCustodyGeoData(ctx, chain)),
  );

  if (payloads.length === 0) {
    const facility = await getFacilityGeoIdentity(ctx, batch.facilityId);
    return {
      facility,
      nodes: [],
      legs: [],
      warnings: ["This credit batch has no member applications yet."],
    };
  }

  const nodeById = new Map<string, ChainGeoNode>();
  const legById = new Map<string, ChainGeoLeg>();
  const warnings = new Set<string>();
  for (const payload of payloads) {
    for (const node of payload.nodes) {
      if (!nodeById.has(node.id)) nodeById.set(node.id, node);
    }
    for (const leg of payload.legs) {
      if (!legById.has(leg.id)) legById.set(leg.id, leg);
    }
    for (const warning of payload.warnings) {
      warnings.add(warning);
    }
  }

  return {
    facility: payloads[0].facility,
    nodes: Array.from(nodeById.values()),
    legs: Array.from(legById.values()),
    warnings: Array.from(warnings),
  };
}

async function getFacilityIdentity(ctx: OrgContext, facilityId: string): Promise<ChainFacility> {
  const [row] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) {
    throw new SafeError("Facility not found for credit batch");
  }
  return row;
}

async function getFacilityGeoIdentity(
  ctx: OrgContext,
  facilityId: string,
): Promise<ChainOfCustodyGeoData["facility"]> {
  const [row] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
      lat: facilities.gpsLatitude,
      lng: facilities.gpsLongitude,
    })
    .from(facilities)
    .where(and(eq(facilities.id, facilityId), eq(facilities.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) {
    throw new SafeError("Facility not found for credit batch");
  }
  return row;
}
