import {
  BATCH_DETAILS_FIX_LABEL,
  batchHealthFixLinkFor,
  creditBatchListHref,
  type BatchHealthFixLink,
} from "./batch-health-links";
import type { BatchHealthFixTarget } from "./batch-health";
import type { RemovalAdvisory, RemovalBlocker } from "./removal-blockers";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { isTemplateFixTarget, templateLineFixTarget } from "./template-fix-targets";

/** Targets that repair the credit batch itself. Every other target is per record. */
const BATCH_SCOPED_TARGETS: ReadonlySet<BatchHealthFixTarget> = new Set(["creditBatchTemplate", "templateReplacement", "batchDetails", "emissions"]);

/**
 * The one repair link for a Removal blocker or advisory. A finding with no
 * `fixTarget` has several destinations (or none that is safe to name), so it
 * gets no link rather than a guessed one.
 *
 * With exactly one member credit batch, batch-scoped targets land on that batch.
 * Per-record targets (Samples, runs, deliveries) resolve without a batch id, as
 * the checks list does, so a repair never turns into a create intent. Batch
 * details live only inside the credit batch view, so the shared `#batch-details`
 * anchor is never returned.
 */
export function removalFindingFixLink(
  finding: Pick<RemovalBlocker | RemovalAdvisory, "fixTarget"> & { code?: RemovalBlocker["code"] | RemovalAdvisory["code"] },
  facilityId: string,
  memberBatchIds: readonly string[] = [],
): BatchHealthFixLink | null {
  // Template findings route through the one table, so a decided line never says "Decide lines".
  const target = finding.code && isTemplateFixTarget(finding.fixTarget)
    ? templateLineFixTarget({ code: finding.code, fixTarget: finding.fixTarget })
    : finding.fixTarget;
  if (!target) return null;
  const batchId = memberBatchIds.length === 1 && BATCH_SCOPED_TARGETS.has(target) ? memberBatchIds[0] : undefined;
  if (target === "batchDetails") {
    return {
      label: BATCH_DETAILS_FIX_LABEL,
      href: batchId ? creditBatchDeepLinkHref(batchId, facilityId) : creditBatchListHref(facilityId),
    };
  }
  return batchHealthFixLinkFor({ key: target === "creditBatchTemplate" ? "templateSet" : "templateLines", fixTarget: target }, facilityId, batchId);
}
