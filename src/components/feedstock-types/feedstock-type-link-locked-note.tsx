import { recordHref } from "@/lib/record-links";
import Link from "next/link";
import { Fragment } from "react";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import {
  ISOMETRIC_LINK_LOCKED_HOW_TO_FREE,
  ISOMETRIC_LINK_LOCKED_REASON,
} from "@/lib/feedstock-type-link-lock-copy";

/** Removals named inline; the rest are counted, as in the record lock lines. */
const NAMED_REMOVALS = 2;

interface LockingRemoval {
  id: string;
  code: string;
  facilityId: string;
}

/**
 * The Sent lock line of a saved Isometric link: the Removals that hold it, each
 * code a link to that Removal on its own facility, then how to free it.
 */
export function FeedstockTypeLinkLockedNote({ removals }: { removals: readonly LockingRemoval[] }) {
  const named = removals.slice(0, NAMED_REMOVALS);
  const more = removals.length - named.length;
  const parts = [
    ...named.map((removal) => (
      <>
        Removal{" "}
        <Link href={recordHref("removal", removal.id, { facilityId: removal.facilityId })} className={RECORD_CODE_LINK}>
          {removal.code}
        </Link>
      </>
    )),
    ...(more > 0 ? [`${more} more`] : []),
  ];
  return (
    <Notice tone="info" boxed data-record-lock-notice="sent">
      {ISOMETRIC_LINK_LOCKED_REASON}{" "}
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (index === parts.length - 1 ? " and " : ", ")}
          {part}
        </Fragment>
      ))}
      . {ISOMETRIC_LINK_LOCKED_HOW_TO_FREE}
    </Notice>
  );
}
