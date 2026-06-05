"use server";

import { env } from "@/config/env";
import {
  listRemovalsForFacility,
  listUngroupedCreditBatches,
} from "@/data-access/certifier-removals";
import {
  deriveRemovalReadiness,
  type RemovalReadiness,
} from "@/lib/certification/readiness";
import { toRemovalReadinessFacts } from "@/lib/certification/readiness-facts";
import type { LocalSubmissionStatus } from "@/lib/certification/status";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import {
  buildRemovalContext,
  loadFacilityCertifierFacts,
  resolveScopeForRemoval,
} from "./certify-context";

// Per-removal readiness rebuilds the submission context (DB-only — the facility
// half is resolved once up front). Bound how many run at once so a facility with
// many removals can't fan out an unbounded burst of query chains at the pool.
const READINESS_CONCURRENCY = 8;

// One removal's place in the work queue: its identity, member batches, latest
// submission identity, and the readiness verdict (the same one the Removals
// table hint and the Review pre-flight will render).
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
}

export interface CertificationOverviewData {
  removals: RemovalPreflightSummary[];
  /** Credit batches not yet grouped into a removal — a "needs grouping" nudge. */
  ungroupedBatchCount: number;
  isProduction: boolean;
}

/**
 * Server-owned readiness for the Overview work queue. Computes a per-removal
 * verdict once, server-side, by reusing the same submission context the submit
 * pipeline does — so the queue, the table hint, and the pre-flight can never
 * disagree about whether a removal is submittable.
 *
 * The facility-scoped certifier facts (mapping / template / blueprints) are
 * resolved ONCE via `loadFacilityCertifierFacts` and fed to every removal's
 * `buildRemovalContext`; each removal adds only its own lineage-level half. The
 * per-removal builds run in parallel. The readiness verdict comes from the
 * shared `toRemovalReadinessFacts` + `deriveRemovalReadiness` — the same
 * projection the Review pre-flight uses.
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
            const scope = await resolveScopeForRemoval(userId, removal.id);
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
            };
          }),
      );
      removals.push(...summaries);
    }

    return {
      removals,
      ungroupedBatchCount: ungroupedBatches.length,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
