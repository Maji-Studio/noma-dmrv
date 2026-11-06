"use client";

import { parseAsString, useQueryState } from "nuqs";
import { RECORD_LINKS } from "@/lib/record-links";
import { RemovalDetailSheet } from "./removal-detail-sheet";
import { useLinkedRemoval } from "./use-linked-removal";

type ArchivedRemoval = NonNullable<ReturnType<typeof useLinkedRemoval>["archived"]>;

/** One Removal of an archived facility, open read only over whatever page the link landed on. */
export function ArchivedRemovalSheet({ archived, onClose }: { archived: ArchivedRemoval; onClose: () => void }) {
  return (
    <RemovalDetailSheet
      summary={archived.summary}
      isProduction={archived.isProduction}
      facilityId={archived.facilityId}
      lock={archived.lock}
      readOnly={archived.readOnly}
      timeZone={archived.timeZone}
      open
      onClose={onClose}
    />
  );
}

/**
 * The page with no active facility still opens a `?removal=` link into an
 * archived facility, read only (credit batches do the same). A link into an
 * active facility switches to it, so the list takes over.
 */
export function LinkedRemovalWithoutFacility({ enabled }: { enabled: boolean }) {
  const [removalId, setRemovalId] = useQueryState(
    RECORD_LINKS.removal.param,
    parseAsString.withOptions({ shallow: true, history: "replace" }),
  );
  const { archived } = useLinkedRemoval(removalId, enabled && !!removalId, setRemovalId);
  return archived ? <ArchivedRemovalSheet archived={archived} onClose={() => setRemovalId(null)} /> : null;
}
