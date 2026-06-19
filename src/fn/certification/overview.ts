"use server";

import { z } from "zod";
import { inArray } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/db";
import { creditBatches } from "@/db/schema";
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
import { SafeError } from "@/lib/errors";
import type { LocalSubmissionStatus } from "@/lib/certification/status";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  buildCreditBatchContextWithFacts,
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
 * One credit batch's certification-readiness verdict for the overview cards —
 * the lightweight projection of `BatchHealth` (state + open-issue count) needed
 * to render a card's cert tag without shipping the full checklist.
 */
export interface CreditBatchHealthSummary {
  state: BatchHealthState;
  /** Count of unmet (blocking) checks; 0 when ready. */
  issueCount: number;
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
  // Non-blocking advisories (ADR 0014) — e.g. recorded startup/plant diesel the
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
  return withAction(async (userId) => {
    const [removalRows, ungroupedBatches, facilityFacts] = await Promise.all([
      listRemovalsForFacility(userId, facilityId),
      listUngroupedCreditBatches(userId, facilityId),
      loadFacilityCertifierFacts(userId, facilityId),
    ]);

    // Process in bounded chunks (order-preserving) rather than one unbounded
    // Promise.all over every removal — see READINESS_CONCURRENCY above.
    const removals: RemovalPreflightSummary[] = [];
    for (let i = 0; i < removalRows.length; i += READINESS_CONCURRENCY) {
      const summaries = await Promise.all(
        removalRows
          .slice(i, i + READINESS_CONCURRENCY)
          .map(async (removal): Promise<RemovalPreflightSummary> => {
            const scope = await resolveScopeForRemoval(userId, removal.id, {
              skipPreview: true,
            });
            const ctx = await buildRemovalContext(userId, scope, facilityFacts);
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
    let readyToStartBatchCount = 0;
    for (let i = 0; i < ungroupedBatches.length; i += READINESS_CONCURRENCY) {
      const verdicts = await Promise.all(
        ungroupedBatches
          .slice(i, i + READINESS_CONCURRENCY)
          .map(async (batch) => {
            const ctx = await buildCreditBatchContextWithFacts(
              userId,
              batch.id,
              facilityFacts,
            );
            return deriveBatchHealth(toBatchHealthFacts(ctx, batch.id));
          }),
      );
      readyToStartBatchCount += verdicts.filter(
        (h) => h.state === "ready",
      ).length;
    }

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
  return withAction(async (userId) => {
    const validFacilityId = z.string().uuid().parse(facilityId);
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
      })
      .from(creditBatches)
      .where(inArray(creditBatches.id, ids));
    const facilityByBatchId = new Map(
      batchFacilityRows.map((row) => [row.id, row.facilityId]),
    );
    const invalidBatchId = ids.find(
      (batchId) => facilityByBatchId.get(batchId) !== validFacilityId,
    );
    if (invalidBatchId) {
      throw new SafeError("Batch does not belong to requested facility");
    }

    const facilityFacts = await loadFacilityCertifierFacts(
      userId,
      validFacilityId,
    );
    const summaries: Record<string, CreditBatchHealthSummary> = {};
    for (let i = 0; i < ids.length; i += READINESS_CONCURRENCY) {
      const verdicts = await Promise.all(
        ids.slice(i, i + READINESS_CONCURRENCY).map(async (batchId) => {
          const ctx = await buildCreditBatchContextWithFacts(
            userId,
            batchId,
            facilityFacts,
          );
          if (ctx.facilityId !== validFacilityId) {
            throw new SafeError("Batch does not belong to requested facility");
          }
          const health = deriveBatchHealth(toBatchHealthFacts(ctx, batchId));
          return [
            batchId,
            { state: health.state, issueCount: health.issueCount },
          ] as const;
        }),
      );
      for (const [batchId, summary] of verdicts) {
        summaries[batchId] = summary;
      }
    }
    return summaries;
  });
}
