"use client";

import Link from "next/link";
import { DetailSection } from "@/components/ui/detail-panel";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useRecordUsedByChain } from "@/hooks/use-record-used-by-chain";
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import type { RecordUsedByKind } from "@/lib/record-used-by-chain";
import { recordLockLinkHref, recordLockLinkTitle } from "./record-lock-labels";
import { withUnmatchedUsers } from "./record-used-by-layout";
import { UsedBySchematic } from "./record-used-by-schematic";

/** The open record, so "Used by" can read the chain it went into. */
export interface UsedByRecord {
  kind: RecordUsedByKind;
  id: string | null | undefined;
}

/** Lines the section up with the numbered sections' content (24px rail + 12px gap) and drops the hairline they do not have. */
const ALIGN_WITH_NUMBERED = "[div:has(>section)+&]:pl-36 [div:has(>section)+&]:border-t-0";
const CHART_PENDING_HEIGHT = "h-96";

/**
 * "Used by": what the record came from and everything it went into, as a
 * small Flow schematic, each box opening its own sheet. Shown on every read
 * sheet after the record's own sections; nothing renders until the lock read
 * answers. Without a `record` (a storage bin, whose users are bin references)
 * or when the chain read fails, the lock's plain link list stands in.
 */
export function RecordUsedBy({ lock, record }: { lock: RecordLockView | undefined; record?: UsedByRecord }) {
  const wantsChain = !!lock && lock.usedBy.length > 0 && !!record?.id;
  const chain = useRecordUsedByChain(record?.kind, record?.id, wantsChain);
  const { timeZone } = useFacilityClock(chain.data?.self.facilityId);
  if (!lock) return null;

  let body;
  if (lock.usedBy.length === 0) body = <UsedByNone />;
  else if (!wantsChain || chain.isError) body = <UsedByLinks usedBy={lock.usedBy} />;
  else if (!chain.data) body = <div role="status" aria-busy="true" aria-label="Loading records"><Skeleton className={`${CHART_PENDING_HEIGHT} w-full`} /></div>;
  else body = <UsedBySchematic graph={withUnmatchedUsers(chain.data, lock.usedBy)} timeZone={timeZone} />;

  return <DetailSection title="Used by" className={ALIGN_WITH_NUMBERED}>{body}</DetailSection>;
}

function UsedByNone() {
  return <p className="body-medium text-[var(--color-text-tertiary)]" data-empty>{MISSING_VALUE.none}</p>;
}

/** Every user as an underlined link to its sheet: the fallback and the storage bin's list. */
function UsedByLinks({ usedBy }: { usedBy: RecordLockLink[] }) {
  return (
    <ul className="flex flex-col" aria-label="Used by">
      {usedBy.map((link) => {
        const href = recordLockLinkHref(link);
        const title = recordLockLinkTitle(link);
        return (
          <li key={`${link.kind}:${link.id}`} className="flex min-h-44 items-center body-medium">
            {href ? <Link href={href} className="underline underline-offset-4">{title}</Link> : title}
          </li>
        );
      })}
    </ul>
  );
}
