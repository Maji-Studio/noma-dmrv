/**
 * BlockedComponentsNotice: the error Notice at the top of the submit step. It
 * names each blocked component with its credit batch; each name is a button
 * that scrolls the component table to that row and moves focus to it. What to
 * do stays in the row's state cell, so it is said once. A blocker with no row
 * in the table keeps its own message and repair link.
 */
"use client";

import type { RemovalBlocker } from "@/lib/certification/removal-blockers";
import { jumpToComponentRow } from "./component-table";
import type { ComponentRow } from "./component-table-model";
import { RemovalBlockerList } from "./compilation-notices";

interface BlockedComponentsNoticeProps {
  blockers: RemovalBlocker[];
  blockedRows: ComponentRow[];
  facilityId: string;
  memberBatchIds: readonly string[];
}

export function BlockedComponentsNotice({
  blockers,
  blockedRows,
  facilityId,
  memberBatchIds,
}: BlockedComponentsNoticeProps) {
  const named = new Set(blockedRows.map((row) => row.componentId));
  const others = blockers.filter(
    (blocker) => !(blocker.lineRef && named.has(blocker.lineRef.componentId)),
  );
  const lead = blockedRows.map((row) => (
    <li key={row.componentId}>
      <button
        type="button"
        onClick={() => jumpToComponentRow(row.componentId)}
        className="inline-flex min-h-44 items-center text-left font-medium underline underline-offset-4 hover:text-[var(--color-interaction)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] md:min-h-0"
      >
        {row.name}
      </button>
      {row.blocked && row.blocked.batchCodes.length > 0 && (
        <span className="font-mono"> on {row.blocked.batchCodes.join(", ")}</span>
      )}
    </li>
  ));
  return (
    <RemovalBlockerList
      blockers={others}
      facilityId={facilityId}
      memberBatchIds={memberBatchIds}
      lead={lead.length > 0 ? lead : undefined}
    />
  );
}
