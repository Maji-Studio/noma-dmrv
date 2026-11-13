"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { DetailSection } from "@/components/ui/detail-panel";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { usePrototypeUsedBy } from "@/hooks/use-prototype-used-by";
import { MISSING_VALUE, TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { prototypeNodeKey, type PrototypeUsedByGraph, type PrototypeUsedByKind, type PrototypeUsedByNode } from "@/lib/prototype-used-by";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { recordLockLinkHref, recordLockLinkTitle } from "./record-lock-labels";
import { UsedByRecordRows } from "./record-used-by-prototype-a";
import { UsedBySchematic } from "./record-used-by-prototype-b";
import { UsedByWalk } from "./record-used-by-prototype-c";
import { prototypeFixture } from "./record-used-by-prototype-fixtures";
import { UsedByNone, UsedBySection, usedByRows } from "./record-used-by-prototype-shared";
import { UsedByPrototypeSwitcher, useUsedByPrototype } from "./record-used-by-prototype-switcher";

/** PROTOTYPE ONLY: the open record, so the variants can read its chain. */
export interface UsedByRecord {
  kind: PrototypeUsedByKind;
  id: string | null | undefined;
}

/**
 * "Used by": every record that took a number from this one, each opening its
 * own sheet through the shared deep links. Shown on every read sheet, after
 * the record's own sections; nothing renders until the lock read answers.
 *
 * PROTOTYPE ROUND: `?variant=a|b|c` swaps this section, `?scenario=many|none`
 * its data (see record-used-by-prototype-switcher.tsx). No param is today's.
 */
export function RecordUsedBy({ lock, record }: { lock: RecordLockView | undefined; record?: UsedByRecord }) {
  const proto = useUsedByPrototype();
  const needsGraph = (proto.variant !== null || proto.scenario === "many") && !!lock;
  const query = usePrototypeUsedBy(record?.kind ?? null, record?.id, needsGraph);
  const { timeZone } = useFacilityClock(query.data?.self.facilityId);
  if (!lock) return null;

  const fixture = proto.scenario === "many" ? prototypeFixture(query.data?.self ?? placeholderSelf(record)) : null;
  const usedBy = proto.scenario === "none" ? [] : fixture?.usedBy ?? lock.usedBy;
  const switcher = <UsedByPrototypeSwitcher proto={proto} />;

  if (proto.variant === null) {
    return (
      <>
        <CurrentUsedBy usedBy={usedBy} />
        <div aria-hidden className="h-80 shrink-0" />
        {switcher}
      </>
    );
  }

  // The fixture needs no read; the real chain waits for it (or falls back to the lock's links without a record).
  const waiting = !fixture && proto.scenario === "real" && !!record?.id && query.isPending;
  const failed = !fixture && proto.scenario === "real" && query.isError;
  const graph = fixture?.graph ?? (query.data ? withUnmatched(query.data, usedBy) : null);

  let body: ReactNode;
  if (usedBy.length === 0) body = <UsedByNone />;
  else if (waiting) body = <div role="status" aria-busy="true" aria-label="Loading records"><Skeleton className="h-96 w-full" /></div>;
  else if (failed) {
    body = (
      <Notice tone="error" action={<Button variant="weak" size="small" className={INLINE_HIT_AREA} busy={query.isFetching} onClick={() => void query.refetch()}>{TRY_AGAIN_LABEL}</Button>}>
        These records could not be loaded.
      </Notice>
    );
  } else if (proto.variant === "a" || !graph) body = <UsedByRecordRows rows={usedByRows(usedBy, graph, timeZone)} />;
  else if (proto.variant === "b") body = <UsedBySchematic graph={graph} timeZone={timeZone} />;
  else body = <UsedByWalk graph={graph} timeZone={timeZone} />;

  return (
    <>
      <UsedBySection>{body}</UsedBySection>
      {/* Room to scroll the section clear of the floating switcher. */}
      <div aria-hidden className="h-80 shrink-0" />
      {switcher}
    </>
  );
}

/** Today's section, unchanged. */
function CurrentUsedBy({ usedBy }: { usedBy: RecordLockLink[] }) {
  return (
    <DetailSection title="Used by">
      {usedBy.length === 0 ? (
        <p className="body-medium text-[var(--color-text-tertiary)]" data-empty>{MISSING_VALUE.none}</p>
      ) : (
        <ul className="flex flex-col" aria-label="Used by">
          {usedBy.map((link) => {
            const href = link.id.startsWith("fx-") ? null : recordLockLinkHref(link);
            const title = recordLockLinkTitle(link);
            return (
              <li key={`${link.kind}:${link.id}`} className="flex min-h-44 items-center body-medium">
                {href ? <Link href={href} className="underline underline-offset-4">{title}</Link> : title}
              </li>
            );
          })}
        </ul>
      )}
    </DetailSection>
  );
}

function placeholderSelf(record: UsedByRecord | undefined): PrototypeUsedByNode {
  return { kind: record?.kind ?? "productionRun", id: record?.id ?? "fx-self", code: "", name: null, facilityId: null, at: null, calendarDay: false, fixture: true };
}

/**
 * Users the chain read does not reach (a stock count, a bin reference) still
 * show, as their own column or step, so nothing in "Used by" goes missing.
 * Credit batches stay context, never a node.
 */
function withUnmatched(graph: PrototypeUsedByGraph, usedBy: RecordLockLink[]): PrototypeUsedByGraph {
  const known = new Set(graph.downstream.map((node) => prototypeNodeKey(node.kind, node.id)));
  const extra: PrototypeUsedByNode[] = usedBy
    .filter((link) => link.kind !== "creditBatch" && !known.has(prototypeNodeKey(link.kind, link.id)))
    .map((link) => ({
      kind: link.kind as PrototypeUsedByKind, id: link.id, code: link.label ?? recordLockLinkTitle(link), name: null,
      facilityId: link.facilityId, at: link.period?.completedOn ?? null, calendarDay: true, fixture: !recordLockLinkHref(link),
    }));
  const edges = extra.map((node) => ({ from: prototypeNodeKey(graph.self.kind, graph.self.id), to: prototypeNodeKey(node.kind, node.id), mass: null }));
  return extra.length ? { ...graph, downstream: [...graph.downstream, ...extra], edges: [...graph.edges, ...edges] } : graph;
}
