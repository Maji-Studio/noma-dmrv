import { Notice } from "@/components/ui/notice";
import { pluralize } from "@/lib/copy-utils";
import type { RemovalListRow } from "./removal-list-state";

/**
 * Issue #737: whether Isometric's GraphQL readback confirmed the evidence
 * Sources on this Removal's Biochar Applications. No answer lets the Removal
 * continue, so both states are warnings; the summary rechecks on every load.
 */
export const EVIDENCE_LINKS_UNCONFIRMED_TITLE = "Evidence links not confirmed";
export const EVIDENCE_LINKS_MISMATCH_TITLE = "Evidence links do not match";

function applications(count: number): string {
  return `${count} Biochar ${pluralize(count, "Application")}`;
}

export function evidenceLinksNoticeCopy(
  links: RemovalListRow["evidenceLinks"],
): { title: string; text: string } | null {
  if (!links) return null;
  if (links.mismatchCount > 0) {
    return {
      title: EVIDENCE_LINKS_MISMATCH_TITLE,
      text: `Isometric lists different evidence on ${applications(links.mismatchCount)} than this Removal sent. Check the evidence on Isometric.`,
    };
  }
  if (links.unconfirmedCount > 0) {
    return {
      title: EVIDENCE_LINKS_UNCONFIRMED_TITLE,
      text: `Isometric has not confirmed the evidence on ${applications(links.unconfirmedCount)}. Reload this page to check again.`,
    };
  }
  return null;
}

export function RemovalEvidenceLinksNotice({
  links,
}: {
  links: RemovalListRow["evidenceLinks"];
}) {
  const copy = evidenceLinksNoticeCopy(links);
  if (!copy) return null;
  return (
    <Notice tone="warning" title={copy.title} data-removal-evidence-links>
      {copy.text}
    </Notice>
  );
}
