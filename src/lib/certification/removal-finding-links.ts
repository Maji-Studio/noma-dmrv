import { batchHealthFixLinkFor, type BatchHealthFixLink } from "./batch-health-links";
import type { RemovalAdvisory, RemovalBlocker } from "./removal-blockers";

/**
 * The one repair link for a Removal blocker or advisory. A finding with no
 * `fixTarget` has several destinations (or none that is safe to name), so it
 * gets no link rather than a guessed one.
 */
export function removalFindingFixLink(
  finding: Pick<RemovalBlocker | RemovalAdvisory, "fixTarget">,
  facilityId: string,
): BatchHealthFixLink | null {
  if (!finding.fixTarget) return null;
  return batchHealthFixLinkFor({ key: "template", fixTarget: finding.fixTarget }, facilityId);
}
