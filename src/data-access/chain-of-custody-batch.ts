/**
 * Chain of custody — credit-batch roll-up (chain-of-custody views Phase 3).
 *
 * Re-anchors the chain-of-custody page on the credit batch (ADR 0011): the
 * batch roll-up is its member applications' rollbacks merged, runs deduped —
 * resolved by reusing `getChainOfCustodyData` per application exactly like
 * the certification path (`certify-context-core.ts`), not a new traversal.
 * The Sankey aggregates come from the same payload via the pure
 * `buildBatchSankey` builder; the geo roll-up merges the per-application
 * Phase 2 geo payloads so the Carbon Transit map renders unchanged.
 */
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities } from "@/db/schema";
import {
  buildBatchSankey,
  type CreditBatchSankeyData,
} from "@/lib/chain-of-custody/sankey";
import { SafeError } from "@/lib/errors";
import {
  getChainOfCustodyData,
  type ChainFacility,
  type ChainOfCustodyData,
} from "./chain-of-custody";
import {
  getChainOfCustodyGeoData,
  type ChainGeoLeg,
  type ChainGeoNode,
  type ChainOfCustodyGeoData,
} from "./chain-of-custody-geo";
import { getCreditBatchById } from "./credit-batches";
import { getApplicationsForRuns } from "./credit-batch-production-runs";
import { requireAuth } from "./utils";

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
  batch: NonNullable<Awaited<ReturnType<typeof getCreditBatchById>>>;
  applicationIds: string[];
  lineages: CreditBatchChainLineage[];
}

async function getApplicationIdsForBatchRuns(
  userId: string,
  productionRunIds: string[],
): Promise<string[]> {
  const applicationsForRuns = await getApplicationsForRuns(
    userId,
    productionRunIds,
  );
  return Array.from(new Set(applicationsForRuns.map((row) => row.applicationId)));
}

// The roll-up's lineage walk — shared by the chain and geo payloads. The
// co2eStored preview is skipped: this page reads recorded masses, not the
// certification preview math.
async function resolveBatchScope(
  userId: string,
  creditBatchId: string,
): Promise<ResolvedBatchScope> {
  const batch = await getCreditBatchById(userId, creditBatchId, {
    skipPreview: true,
  });
  if (!batch) {
    throw new SafeError("Credit batch not found");
  }

  const applicationIds = await getApplicationIdsForBatchRuns(
    userId,
    batch.productionRunIds,
  );
  const lineages = await Promise.all(
    applicationIds.map(async (applicationId) => ({
      applicationId,
      chain: await getChainOfCustodyData(userId, applicationId),
    })),
  );
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
  userId: string,
  creditBatchId: string,
): Promise<CreditBatchChainData> {
  requireAuth(userId);

  const { batch, lineages } = await resolveBatchScope(userId, creditBatchId);

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
      lineages[0]?.chain.facility ?? (await getFacilityIdentity(batch.facilityId)),
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
  userId: string,
  creditBatchId: string,
): Promise<ChainOfCustodyGeoData> {
  requireAuth(userId);

  const { batch, applicationIds } = await resolveBatchScope(
    userId,
    creditBatchId,
  );

  const payloads = await Promise.all(
    applicationIds.map((applicationId) =>
      getChainOfCustodyGeoData(userId, applicationId),
    ),
  );

  if (payloads.length === 0) {
    const facility = await getFacilityGeoIdentity(batch.facilityId);
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

async function getFacilityIdentity(facilityId: string): Promise<ChainFacility> {
  const [row] = await db
    .select({
      id: facilities.id,
      code: facilities.code,
      name: facilities.name,
    })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
    .limit(1);
  if (!row) {
    throw new SafeError("Facility not found for credit batch");
  }
  return row;
}

async function getFacilityGeoIdentity(
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
    .where(eq(facilities.id, facilityId))
    .limit(1);
  if (!row) {
    throw new SafeError("Facility not found for credit batch");
  }
  return row;
}
