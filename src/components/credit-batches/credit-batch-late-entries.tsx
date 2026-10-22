/**
 * "Recorded after RM-26-009 was sent": the entries of this credit batch that
 * were recorded once its Removal was sent, each with its date, figure and
 * where it goes (#1059). The Blocking to-do carries the action, so the list
 * says where each one stands.
 */
"use client";

import { useBatchEmissionLines } from "@/hooks/use-emission-entries";
import { InfoHint } from "@/components/ui/tooltip";
import { LateEntryDestinationLine } from "@/components/emissions/late-entry-status";
import { formatFigure } from "@/components/emissions/emission-line-display";
import { lateEntryRows } from "@/lib/certification/late-entry-list";
import { formatDayString } from "@/lib/format-utils";
import { MUTED_TEXT } from "./credit-batch-page-parts";
import { cn } from "@/lib/utils";

const WHY = "An entry recorded after the Removal was sent stays part of this credit batch, whichever Removal reports it. The next Removal of this facility includes it, and Isometric gets a note that it belongs to this credit batch.";

export function CreditBatchLateEntries({ facilityId, creditBatchId }: { facilityId: string; creditBatchId: string }) {
  const { data: lines } = useBatchEmissionLines({ facilityId, creditBatchId });
  const rows = lateEntryRows(lines ?? [], facilityId);
  if (!rows.length) return null;
  const removalCodes = [...new Set(rows.map((row) => row.view.recordedAfter.removalCode))].join(", ");
  return (
    <section aria-labelledby="late-entries-title" className="flex flex-col gap-8 border-t border-[var(--color-border-secondary)] pt-16" data-late-entries>
      <h3 id="late-entries-title" className="inline-flex items-center gap-4 body-small font-medium">
        <span>Recorded after {removalCodes} was sent</span>
        <InfoHint label="What happens to entries recorded after the Removal was sent">{WHY}</InfoHint>
      </h3>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-2 border-t border-[var(--color-border-tertiary)] py-10">
            <span className="body-small">
              {row.componentName}
              <span className={cn(MUTED_TEXT)}> · {formatDayString(row.occurredOn)}</span>
            </span>
            <span className="text-right body-small tabular-nums">{formatFigure(row.total)}</span>
            <LateEntryDestinationLine destination={row.view.destination} className="col-span-2" withAction={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
