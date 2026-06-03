"use server";

import { env } from "@/config/env";
import {
  listRemovalsForFacility,
  listUngroupedCreditBatches,
} from "@/data-access/certifier-removals";
import {
  deriveRemovalReadiness,
  type RemovalReadiness,
  type TransportCategory,
} from "@/lib/certification/readiness";
import type { LocalSubmissionStatus } from "@/lib/certification/status";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import type { ActionResult } from "@/types/actions";
import { withAction } from "../with-action";
import { loadRemovalSubmissionContext } from "./certify-context";

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
 * Cost: this builds the full submission context per removal, which re-resolves
 * the facility-level Isometric template/blueprint data for each one. Facilities
 * carry few removals (ADR 0003: ~1/month) so this is acceptable; the
 * per-removal builds run in parallel. A facility-level fetch shared across
 * removals is a deferred optimisation (docs/open-questions.md).
 */
export async function loadCertificationOverview(
  facilityId: string,
): Promise<ActionResult<CertificationOverviewData>> {
  return withAction(async (userId) => {
    const [removalRows, ungroupedBatches] = await Promise.all([
      listRemovalsForFacility(userId, facilityId),
      listUngroupedCreditBatches(userId, facilityId),
    ]);

    const removals = await Promise.all(
      removalRows.map(async (removal): Promise<RemovalPreflightSummary> => {
        const ctx = await loadRemovalSubmissionContext(userId, removal.id);
        const latest = ctx.latestSubmission;
        const lockInFlight = latest ? isLockedInFlight(latest) : false;
        const local = (latest?.status ?? null) as LocalSubmissionStatus | null;

        const requiredTransport = ctx.requiredTransportCategories.map(
          (category) => {
            const bucket = ctx.transportCoverage[category];
            return {
              category: category as TransportCategory,
              count: bucket.count,
              hasAggregationWarning: bucket.aggregationWarning !== null,
            };
          },
        );

        const readiness = deriveRemovalReadiness({
          local,
          lockInFlight,
          hasMapping: !!ctx.mapping,
          hasDefaultTemplate: !!ctx.defaultTemplate,
          missingDefaultTemplateId: ctx.missingDefaultTemplateId,
          unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
          hasSubmittableRuns: ctx.runs.length > 0,
          requiredTransport,
        });

        return {
          removalId: removal.id,
          startedOn: removal.startedOn,
          completedOn: removal.completedOn,
          memberBatchCodes: ctx.memberBatches.map((b) => b.code),
          externalId: latest?.externalId ?? null,
          version: latest?.version ?? null,
          local,
          lockInFlight,
          readiness,
        };
      }),
    );

    return {
      removals,
      ungroupedBatchCount: ungroupedBatches.length,
      isProduction: env.ISOMETRIC_ENVIRONMENT === "production",
    };
  });
}
