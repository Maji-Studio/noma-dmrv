import { batchHealthFixLinkFor, type BatchHealthFixLink } from "./batch-health-links";
import type { RemovalAdvisory, RemovalBlocker } from "./removal-blockers";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";

/**
 * The one repair link for a Removal blocker or advisory. A finding with no
 * `fixTarget` has several destinations (or none that is safe to name), so it
 * gets no link rather than a guessed one.
 *
 * With exactly one member credit batch the link lands on that batch. Batch
 * details live only inside the credit batch view, so the shared `#batch-details`
 * anchor is never returned: it resolves to the batch (or the batch list).
 */
export function removalFindingFixLink(
  finding: Pick<RemovalBlocker | RemovalAdvisory, "fixTarget">,
  facilityId: string,
  memberBatchIds: readonly string[] = [],
): BatchHealthFixLink | null {
  if (!finding.fixTarget) return null;
  const batchId = memberBatchIds.length === 1 ? memberBatchIds[0] : undefined;
  if (finding.fixTarget === "batchDetails") {
    return {
      label: "Edit details",
      href: batchId
        ? creditBatchDeepLinkHref(batchId, facilityId)
        : `/credit-batches?${new URLSearchParams({ facility: facilityId })}`,
    };
  }
  return batchHealthFixLinkFor({ key: "template", fixTarget: finding.fixTarget }, facilityId, batchId);
}
