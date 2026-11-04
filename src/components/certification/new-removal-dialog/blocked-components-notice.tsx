/**
 * BlockedComponentsNotice: the error Notice at the top of the submit step. It
 * names each blocked component with its credit batch; each name is a button
 * that scrolls the component table to that row and moves focus to it. What to
 * do stays in the row's state cell, so it is said once: a compile blocker is
 * dropped only when a named row shows the same message. Any other blocker keeps
 * its own message and repair link.
 */
"use client";

import type { RemovalBlocker } from "@/lib/certification/removal-blockers";
import { componentRowDomId, jumpToComponentRow } from "./component-table";
import type { ComponentRow } from "./component-table-model";
import { RemovalBlockerList } from "./compilation-notices";

interface BlockedComponentsNoticeProps {
  blockers: RemovalBlocker[];
  blockedRows: ComponentRow[];
  facilityId: string;
  memberBatchIds: readonly string[];
  /** The compiler's one sentence naming every unbindable component, and the ids it names. */
  unbindableText?: string | null;
  unbindableComponentIds?: readonly string[];
}

export function BlockedComponentsNotice({
  blockers,
  blockedRows,
  facilityId,
  memberBatchIds,
  unbindableText = null,
  unbindableComponentIds = [],
}: BlockedComponentsNoticeProps) {
  const shown = new Map(
    blockedRows.map((row) => [row.componentId, new Set(row.blocked?.items.map((item) => item.message))]),
  );
  const unbindableNamed = unbindableComponentIds.length > 0 && unbindableComponentIds.every((id) => shown.has(id));
  const others = blockers.filter((blocker) => {
    if (blocker.lineRef && shown.get(blocker.lineRef.componentId)?.has(blocker.message)) return false;
    return !(unbindableNamed && unbindableText !== null && blocker.message === unbindableText);
  });
  const lead = blockedRows.map((row) => {
    const batchCodes = [...new Set(row.blocked?.items.flatMap((item) => item.batchCodes))];
    return (
      <li key={row.componentId}>
        {/* The FormErrorSummary pattern: a real anchor, moved by script. */}
        <a
          href={`#${componentRowDomId(row.componentId)}`}
          onClick={(event) => {
            event.preventDefault();
            jumpToComponentRow(row.componentId);
          }}
          className="inline-flex min-h-44 items-center font-medium underline underline-offset-4 hover:text-[var(--color-interaction)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] md:min-h-0"
        >
          <span>{row.name}</span>
        </a>
        {batchCodes.length > 0 && <span className="font-mono"> on {batchCodes.join(", ")}</span>}
      </li>
    );
  });
  return (
    <RemovalBlockerList
      blockers={others}
      facilityId={facilityId}
      memberBatchIds={memberBatchIds}
      lead={lead.length > 0 ? lead : undefined}
    />
  );
}
