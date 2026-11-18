/**
 * SourceRecords: the records behind this Removal, folded under each credit
 * batch (production runs, applications, deliveries, feedstock intake), the
 * same list as the Removal sheet's Records section. The Storage sites link
 * sits under it when the facility is linked to a project.
 */
"use client";

import { RemovalRecords } from "../removal-records";
import { NewTabLink } from "./link-label";

interface SourceRecordsProps {
  removalId: string;
  facilityId: string;
  /** The facility's storage sites in Isometric, when it is linked to a project. */
  storageSitesHref: string | null;
  /** A record link was used: the review is read again when the operator returns. */
  onFix?: () => void;
}

export function SourceRecords({ removalId, facilityId, storageSitesHref, onFix }: SourceRecordsProps) {
  return (
    <section aria-labelledby="review-records" className="flex flex-col gap-8">
      <h3 id="review-records" className="body-lead font-medium">
        Records
      </h3>
      <RemovalRecords removalId={removalId} facilityId={facilityId} enabled showSummary={false} codeLink={false} mode={{ newTab: true, onOpen: onFix }} />
      {storageSitesHref && (
        <p className="flex items-baseline justify-between gap-12 body-small text-[var(--color-text-secondary)]">
          <span>Storage sites</span>
          <NewTabLink href={storageSitesHref} tall onClick={onFix}>
            View in Isometric
          </NewTabLink>
        </p>
      )}
    </section>
  );
}
