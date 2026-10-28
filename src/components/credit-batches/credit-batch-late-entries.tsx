/**
 * The entries of this credit batch that another credit batch's Removal reports
 * or will report, or that go into the revision of a returned Removal, each with
 * its date, figure and where it goes (#1059). When
 * every entry was recorded after a sent Removal the heading names it ("Recorded
 * after RM-26-009 was sent"); otherwise each entry says so itself when it can.
 * The Check to-do carries the action, so the list says where each one stands.
 */
"use client";

import { Fragment } from "react";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import Link from "next/link";
import { useBatchEmissionLines } from "@/hooks/use-emission-entries";
import { InfoHint } from "@/components/ui/tooltip";
import { LateEntryDestinationLine } from "@/components/emissions/late-entry-status";
import { formatFigure } from "@/components/emissions/emission-line-display";
import { lateEntryRows } from "@/lib/certification/late-entry-list";
import { formatDayString } from "@/lib/format-utils";
import { MUTED_TEXT } from "./credit-batch-page-parts";
import { cn } from "@/lib/utils";

const WHY_OTHER = "An entry that another Removal reports stays part of this credit batch. The next Removal of this facility includes it, and Isometric gets a note that it belongs to this credit batch.";
const WHY_REVISION = "Isometric returned the Removal it was recorded after, so the entry goes into that Removal's revision and is sent when it is resubmitted.";

const PLAIN_HEADING = "Emissions for other Removals";
const MIXED_HEADING = "Emissions entries recorded late";

function RemovalLinks({ removals }: { removals: { removalCode: string; removalHref: string }[] }) {
  return (
    <>
      {removals.map((removal, index) => (
        <Fragment key={removal.removalHref}>
          {index > 0 && (index === removals.length - 1 ? " and " : ", ")}
          <Link href={removal.removalHref} className={RECORD_CODE_LINK}>{removal.removalCode}</Link>
        </Fragment>
      ))}
    </>
  );
}

export function CreditBatchLateEntries({ facilityId, creditBatchId, canManage }: { facilityId: string; creditBatchId: string; canManage: boolean }) {
  const { data: lines } = useBatchEmissionLines({ facilityId, creditBatchId });
  const rows = lateEntryRows(lines ?? [], facilityId, { canManage });
  if (!rows.length) return null;
  const known = rows.flatMap((row) => row.view.recordedAfter ?? []);
  const removals = [...new Map(known.map((removal) => [removal.removalHref, removal])).values()];
  const headingNamesRemovals = known.length === rows.length;
  const revisions = rows.filter((row) => row.view.destination.kind === "revision").length;
  const why = revisions === 0 ? WHY_OTHER : revisions === rows.length ? WHY_REVISION : `${WHY_OTHER} ${WHY_REVISION}`;
  return (
    <section aria-labelledby="late-entries-title" className="flex flex-col gap-8 border-t border-[var(--color-border-secondary)] pt-16" data-late-entries>
      <h3 id="late-entries-title" className="inline-flex items-center gap-4 body-small font-medium">
        <span>
          {headingNamesRemovals ? (
            <>
              Recorded after <RemovalLinks removals={removals} /> {removals.length === 1 ? "was" : "were"} sent
            </>
          ) : revisions ? MIXED_HEADING : PLAIN_HEADING}
        </span>
        <InfoHint label="What happens to these entries">{why}</InfoHint>
      </h3>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <li key={row.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-2 border-t border-[var(--color-border-tertiary)] py-10">
            <span className="body-small">
              {row.componentName}
              <span className={cn(MUTED_TEXT)}> · {formatDayString(row.occurredOn)}</span>
            </span>
            <span className="text-right body-small tabular-nums">{formatFigure(row.total)}</span>
            {!headingNamesRemovals && row.view.recordedAfter && (
              <span className="col-span-2 body-caption text-[var(--color-text-secondary)]">
                Recorded after <RemovalLinks removals={[row.view.recordedAfter]} /> was sent.
              </span>
            )}
            <LateEntryDestinationLine destination={row.view.destination} className="col-span-2" withAction={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
