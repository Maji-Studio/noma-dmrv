"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { SectionLabel } from "@/components/forms/section-label";
import { DetailSection } from "@/components/ui/detail-panel";
import { Button } from "@/components/ui";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useRecordUsedByChain } from "@/hooks/use-record-used-by-chain";
import { MISSING_VALUE, TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import type { RecordUsedByKind } from "@/lib/record-used-by-chain";
import { recordLockLinkHref, recordLockLinkTitle } from "./record-lock-labels";
import { traceabilityHref, usedByGraphIsEmpty, withUnmatchedUsers } from "./record-used-by-graph";
import { TraceabilityLink, UsedByNextStep } from "./record-used-by-next-step";

/** The open record, so "Used by" can read the chain it went into. */
export interface UsedByRecord {
  kind: RecordUsedByKind;
  id: string | null | undefined;
}

/**
 * Used by is not a step, so its hairline runs from the rail across the step
 * numbers and closes them; title and records still start at the numbered
 * sections' content (24px rail + 12px gap) so the reading line holds.
 */
const DIVIDED_AFTER_NUMBERED = "[div:has(>section)+&]:pl-36 pt-24 pb-16";
export const USED_BY_CHAIN_ERROR_MESSAGE = "Couldn't check what uses this record.";
const PENDING_HEIGHT = "h-96";

/**
 * "Used by": the records that used this one directly, with the credit batch
 * and Removal it reached, each opening its own sheet. Shown on every read
 * sheet after the record's own sections; nothing renders until the lock read
 * answers. A Failed run's emissions batch is no lock reference, so its sheet
 * asks for the chain read anyway (`readsChain`). `closing` adds a caption line after the records (a Failed run's
 * emissions batch, #1714). Without a `record` (a storage bin, whose users are bin references)
 * or when the chain read fails, the lock's plain link list stands in.
 */
export function RecordUsedBy({ lock, record, closing, readsChain = false, holdsNone = false }: {
  lock: RecordLockView | undefined;
  record?: UsedByRecord;
  closing?: ReactNode;
  /** Read the chain although the lock names no user. */
  readsChain?: boolean;
  /** Show no "None": the closing line says why the answer is unknown. */
  holdsNone?: boolean;
}) {
  const wantsChain = !!lock && (lock.usedBy.length > 0 || readsChain) && !!record?.id;
  const chain = useRecordUsedByChain(record?.kind, record?.id, wantsChain);
  const { timeZone } = useFacilityClock(chain.data?.self.facilityId);
  if (!lock) return null;

  const graph = wantsChain && chain.data ? withUnmatchedUsers(chain.data, lock.usedBy) : null;
  const href = graph ? traceabilityHref(graph) : null;

  let body;
  const none = holdsNone ? null : <UsedByNone />;
  if (lock.usedBy.length === 0 && !readsChain) body = none;
  else if (wantsChain && chain.isPending) body = <div role="status" aria-busy="true" aria-label="Loading records"><Skeleton className={`${PENDING_HEIGHT} w-full`} /></div>;
  // A forced chain read (a Failed run) that fails must not read as "None": say so and offer Try again.
  else if (wantsChain && chain.isError && lock.usedBy.length === 0) {
    body = (
      <Notice
        tone="warning"
        data-testid="used-by-chain-error"
        action={<Button variant="weak" size="small" busy={chain.isFetching} onClick={() => void chain.refetch()}>{TRY_AGAIN_LABEL}</Button>}
      >
        {USED_BY_CHAIN_ERROR_MESSAGE}
      </Notice>
    );
  }
  // A failed read, or a record the chain read cannot find, keeps the plain list.
  else if (!graph) body = lock.usedBy.length === 0 ? none : <UsedByLinks usedBy={lock.usedBy} />;
  else if (lock.usedBy.length === 0 && usedByGraphIsEmpty(graph)) body = none;
  else body = <UsedByNextStep graph={graph} timeZone={timeZone} />;

  return (
    <DetailSection className={DIVIDED_AFTER_NUMBERED}>
      <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4">
        <SectionLabel>Used by</SectionLabel>
        {href && <TraceabilityLink href={href} />}
      </div>
      {body}
      {closing}
    </DetailSection>
  );
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
