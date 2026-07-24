"use server";

import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/db";
import { certifierRemovals } from "@/db/schema/certification";
import { requireOrgFacility } from "@/data-access/utils";
import { creditBatches } from "@/db/schema";
import { getLatestSubmissionsForEntities } from "@/data-access/certification";
import {
  listRemovalsForFacility,
  listUngroupedCreditBatches,
} from "@/data-access/certifier-removals";
import {
  deriveBatchHealth,
  type BatchHealthState,
} from "@/lib/certification/batch-health";
import { toBatchHealthFacts } from "@/lib/certification/batch-health-facts";
import {
  deriveRemovalReadiness,
  type RemovalReadiness,
} from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import { deriveSubmissionStatus } from "@/lib/certification/from-submission";
import { SafeError } from "@/lib/errors";
import type {
  DerivedStatus,
  LocalSubmissionStatus,
} from "@/lib/certification/status";
import {
  GHG_STATEMENT_ENTITY_TYPE,
  GHG_STATEMENT_SUBMISSION_TYPE,
  ISOMETRIC_PROVIDER,
  REMOVAL_ENTITY_TYPE,
  REMOVAL_SUBMISSION_TYPE,
} from "@/lib/isometric/utils/constants";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  buildCreditBatchContexts,
  buildRemovalContext,
  loadFacilityCertifierFacts,
  resolveScopeForRemoval,
} from "./certify-context-core";

// Per-removal readiness rebuilds the submission context (DB-only — the facility
// half is resolved once up front). Bound how many run at once so a facility with
// many removals can't fan out an unbounded burst of query chains at the pool.
const READINESS_CONCURRENCY = 8;

// Upper bound on how many batch health verdicts one overview request computes —
// the Credit Batches list pages at most 36 cards, so 50 leaves headroom while
// capping the cost of a single fan-out.
const MAX_HEALTH_SUMMARIES = 50;

/**
 * One credit batch's overview status: lightweight data readiness plus the
 * downstream Removal and GHG Statement lifecycles needed by the card rail.
 */
export interface CreditBatchHealthSummary {
  state: BatchHealthState;
  /** Count of unmet (blocking) checks; 0 when ready. */
  issueCount: number;
  /** The Removal this batch belongs to, or null while it is still ungrouped. */
  removalId: string | null;
  /** The Removal's own registry-submission status. */
  removalStatus: DerivedStatus | null;
  /** The downstream GHG Statement, once the submitted Removal is rolled up. */
  ghgStatementId: string | null;
  /** The GHG Statement's verifier lifecycle, kept distinct from the Removal. */
  ghgStatementStatus: DerivedStatus | null;
}

// One removal's place in the Removals hub: its identity, member batches, latest
// submission identity, and the readiness verdict (the same one the table hint
// and wizard submit step render).
export interface RemovalPreflightSummary {
  removalId: string;
  startedOn: string | null;
  completedOn: string | null;
  memberBatchCodes: string[];
  externalId: string | null;
  version: number | null;
  local: LocalSubmissionStatus | null;
  lockInFlight: boolean;
  readiness: RemovalReadiness;
  // Non-blocking advisories (ADR 0015) — e.g. recorded startup/plant diesel the
  // active template cannot carry. Shown alongside readiness; never gates submit.
  submissionWarnings: string[];
}

export interface CertificationOverviewData {
  removals: RemovalPreflightSummary[];
  /** Every credit batch not yet grouped into a removal (healthy or not). */
  ungroupedBatchCount: number;
  /**
   * Ungrouped batches whose own data is complete enough to start a removal —
   * the subset of `ungroupedBatchCount` that the New-Removal wizard would let
   * you select. Computed from the SAME per-batch health verdict the wizard
   * shows, so the Removals hub's "ready to start" affordance can never claim a
   * batch is ready that the wizard then greys out.
   */
  readyToStartBatchCount: number;
  isProduction: boolean;
}

/**
 * Server-owned readiness for the Removals hub. Computes a per-removal
 * verdict once, server-side, by reusing the same submission context the submit
 * pipeline does — so the table hint, detail sheet, and wizard submit step can
 * never disagree about whether a removal is submittable.
 *
 * The facility-scoped certifier facts (mapping / template / blueprints) are
 * resolved ONCE via `loadFacilityCertifierFacts` and fed to every removal's
 * `buildRemovalContext`; each removal adds only its own lineage-level half. The
 * per-removal builds run in parallel. The readiness verdict comes from the
 * shared `toRemovalReadinessFacts` + `deriveRemovalReadiness` — the same
 * projection the wizard submit step uses.
 */
export async function loadCertificationOverview(
  facilityId: string,
): Promise<ActionResult<CertificationOverviewData>> {
  return withAction(async (orgCtx) => {
    await requireOrgFacility(orgCtx, facilityId);
    const [removalRows, ungroupedBatches, facilityFacts] = await Promise.all([
      listRemovalsForFacility(orgCtx, facilityId),
      listUngroupedCreditBatches(orgCtx, facilityId),
      loadFacilityCertifierFacts(orgCtx, facilityId),
    ]);

    // Process in bounded chunks (order-preserving) rather than one unbounded
    // Promise.all over every removal — see READINESS_CONCURRENCY above.
    const removals: RemovalPreflightSummary[] = [];
    for (let i = 0; i < removalRows.length; i += READINESS_CONCURRENCY) {
      const summaries = await Promise.all(
        removalRows
          .slice(i, i + READINESS_CONCURRENCY)
          .map(async (removal): Promise<RemovalPreflightSummary> => {
            const scope = await resolveScopeForRemoval(orgCtx, removal.id, {
              skipPreview: true,
            });
            const ctx = await buildRemovalContext(orgCtx, scope, facilityFacts);
            const facts = toRemovalReadinessFacts(ctx);
            const readiness = deriveRemovalReadiness(facts);

            return {
              removalId: removal.id,
              startedOn: removal.startedOn,
              completedOn: removal.completedOn,
              memberBatchCodes: ctx.memberBatches.map((b) => b.code),
              externalId: ctx.latestSubmission?.externalId ?? null,
              version: ctx.latestSubmission?.version ?? null,
              local: facts.local,
              lockInFlight: facts.lockInFlight,
              readiness,
              submissionWarnings: ctx.submissionWarnings,
            };
          }),
      );
      removals.push(...summaries);
    }

    // "Ready to start": ungrouped batches whose own data is complete, judged by
    // the same `deriveBatchHealth` verdict the New-Removal wizard uses. Built
    // from the facility facts resolved once above and bounded the same way the
    // removal loop is, so the landing page can't fan out an unbounded burst.
    const readyBatchIds = ungroupedBatches.map((batch) => batch.id);
    const { contextsByBatch } = await buildCreditBatchContexts(
      orgCtx,
      readyBatchIds,
      facilityFacts,
    );
    const readyToStartBatchCount = readyBatchIds.filter((batchId) => {
      const health = deriveBatchHealth(
        toBatchHealthFacts(contextsByBatch[batchId], batchId),
      );
      return health.state === "ready";
    }).length;

    return {
      removals,
      ungroupedBatchCount: ungroupedBatches.length,
      readyToStartBatchCount,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}

/**
 * Per-batch certification-readiness verdicts for the Credit Batches overview,
 * keyed by batch id. Reuses the SAME `deriveBatchHealth` classifier the detail
 * page's submission gate (`CreditBatchHealthStrip`) and the New-Removal wizard
 * use, so a card's cert tag can never disagree with the gate it links into.
 *
 * The caller passes the visible page's batch ids (all belonging to `facilityId`,
 * since the list is facility-scoped). The facility certifier facts are resolved
 * once and shared across every batch; the per-batch context builds run in
 * bounded chunks so a wide page can't fan out an unbounded burst at the pool.
 */
export async function loadCreditBatchHealthSummaries(
  facilityId: string,
  batchIds: string[],
): Promise<ActionResult<Record<string, CreditBatchHealthSummary>>> {
  return withAction(async (orgCtx) => {
    const validFacilityId = z.string().uuid().parse(facilityId);
    await requireOrgFacility(orgCtx, validFacilityId);
    const ids = z
      .array(z.string().uuid())
      .max(
        MAX_HEALTH_SUMMARIES,
        `Request at most ${MAX_HEALTH_SUMMARIES} batch health verdicts`,
      )
      .parse(batchIds);
    if (ids.length === 0) return {};

    const batchFacilityRows = await db
      .select({
        id: creditBatches.id,
        facilityId: creditBatches.facilityId,
        removalId: creditBatches.removalId,
        ghgStatementId: certifierRemovals.ghgStatementId,
      })
      .from(creditBatches)
      .leftJoin(
        certifierRemovals,
        and(
          eq(creditBatches.removalId, certifierRemovals.id),
          eq(certifierRemovals.organizationId, orgCtx.organizationId),
        ),
      )
      .where(
        and(
          inArray(creditBatches.id, ids),
          eq(creditBatches.organizationId, orgCtx.organizationId),
        ),
      );
    const facilityByBatchId = new Map(
      batchFacilityRows.map((row) => [row.id, row.facilityId]),
    );
    const invalidBatchId = ids.find(
      (batchId) => facilityByBatchId.get(batchId) !== validFacilityId,
    );
    if (invalidBatchId) {
      throw new SafeError("Batch does not belong to requested facility");
    }

    const batchRowById = new Map(
      batchFacilityRows.map((row) => [row.id, row]),
    );
    const removalIds = Array.from(
      new Set(
        batchFacilityRows.flatMap((row) =>
          row.removalId ? [row.removalId] : [],
        ),
      ),
    );
    const ghgStatementIds = Array.from(
      new Set(
        batchFacilityRows.flatMap((row) =>
          row.ghgStatementId ? [row.ghgStatementId] : [],
        ),
      ),
    );
    const [facilityFacts, removalSubmissions, ghgStatementSubmissions] =
      await Promise.all([
        loadFacilityCertifierFacts(orgCtx, validFacilityId),
        getLatestSubmissionsForEntities(
          orgCtx,
          {
            provider: ISOMETRIC_PROVIDER,
            submissionType: REMOVAL_SUBMISSION_TYPE,
            localEntityType: REMOVAL_ENTITY_TYPE,
            localEntityIds: removalIds,
          },
          validFacilityId,
        ),
        getLatestSubmissionsForEntities(
          orgCtx,
          {
            provider: ISOMETRIC_PROVIDER,
            submissionType: GHG_STATEMENT_SUBMISSION_TYPE,
            localEntityType: GHG_STATEMENT_ENTITY_TYPE,
            localEntityIds: ghgStatementIds,
          },
          validFacilityId,
        ),
      ]);
    const { contextsByBatch } = await buildCreditBatchContexts(
      orgCtx,
      ids,
      facilityFacts,
    );
    const summaries: Record<string, CreditBatchHealthSummary> = {};
    for (const batchId of ids) {
      const ctx = contextsByBatch[batchId];
      if (ctx.facilityId !== validFacilityId) {
        throw new SafeError("Batch does not belong to requested facility");
      }
      const health = deriveBatchHealth(toBatchHealthFacts(ctx, batchId));
      const batchRow = batchRowById.get(batchId);
      const removalId = batchRow?.removalId ?? null;
      const ghgStatementId = batchRow?.ghgStatementId ?? null;
      const removalSubmission = removalId
        ? (removalSubmissions.get(removalId) ?? null)
        : null;
      const ghgStatementSubmission = ghgStatementId
        ? (ghgStatementSubmissions.get(ghgStatementId) ?? null)
        : null;
      summaries[batchId] = {
        state: health.state,
        issueCount: health.issueCount,
        removalId,
        removalStatus: removalId
          ? deriveSubmissionStatus(
              removalSubmission,
              removalSubmission
                ? isLockedInFlight(removalSubmission)
                : false,
              "removal",
            )
          : null,
        ghgStatementId,
        ghgStatementStatus: ghgStatementId
          ? deriveSubmissionStatus(
              ghgStatementSubmission,
              ghgStatementSubmission
                ? isLockedInFlight(ghgStatementSubmission)
                : false,
              "ghgStatement",
            )
          : null,
      };
    }
    return summaries;
  });
}
