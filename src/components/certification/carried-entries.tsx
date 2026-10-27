/**
 * Emissions entries of other credit batches that this Removal sends (#1059):
 * entries recorded after their own batch's Removal was sent, which the next
 * Removal of the facility includes. Two renderings of the same facts, one for
 * the New Removal submit step (a panel below the component table) and one for
 * the Removal sheet (its own section). The component table and the Removal's
 * own batches are not touched. Nothing renders without carried entries.
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { PaperclipIcon } from "@phosphor-icons/react/dist/ssr";
import { DetailSection } from "@/components/ui/detail-panel";
import { InfoHint } from "@/components/ui/tooltip";
import { formatFigure } from "@/components/emissions/emission-line-display";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { pluralize } from "@/lib/copy-utils";
import { formatDayString } from "@/lib/format-utils";
import { removalSheetHref } from "@/lib/removal-correction-copy";
import type { RemovalEntryContributions } from "@/lib/certification/removal-emission-contributions";
import { cn } from "@/lib/utils";
import { EntryFileNames } from "./new-removal-dialog/component-table";
import { NewTabLink } from "./new-removal-dialog/link-label";

export type CarriedEntry = NonNullable<RemovalEntryContributions["carriedEntries"]>[number];

const ICON_SIZE = 14;
const PANEL_TITLE = "Emissions from other credit batches";
const PANEL_CAPTION = "Included automatically. Each stays part of its own credit batch, and Isometric gets a note saying so.";
const SHEET_STATE = { draft: "Included automatically. Sent when this Removal is submitted.", sent: "Sent with this Removal." } as const;
const REVISION_STATE = "Goes out when this Removal is resubmitted.";
const FALLBACK_NAME = "Emissions entry";
// Phone: component and figure, then batch and date, then source. Desktop: five columns.
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-4 md:grid-cols-[minmax(0,1fr)_120px_120px_96px_minmax(0,180px)] md:items-start";

function RecordedAfter({ entry, facilityId, newTab }: { entry: CarriedEntry; facilityId: string; newTab: boolean }) {
  if (!entry.earlierRemovalCode || !entry.earlierRemovalId) return null;
  const href = removalSheetHref(entry.earlierRemovalId, facilityId);
  return (
    <span className="body-caption text-[var(--color-text-secondary)]">
      Recorded after{" "}
      {newTab ? (
        <NewTabLink href={href} mono tall className="text-[var(--color-text-primary)]">{entry.earlierRemovalCode}</NewTabLink>
      ) : (
        <Link href={href} className={RECORD_CODE_LINK}>{entry.earlierRemovalCode}</Link>
      )}{" "}
      was sent.
    </span>
  );
}

function BatchLink({ entry, facilityId, newTab }: { entry: CarriedEntry; facilityId: string; newTab: boolean }) {
  const href = creditBatchDeepLinkHref(entry.creditBatchId, facilityId);
  return newTab ? (
    <NewTabLink href={href} mono tall>{entry.creditBatchCode}</NewTabLink>
  ) : (
    <Link href={href} className={RECORD_CODE_LINK}>{entry.creditBatchCode}</Link>
  );
}

function Files({ entry }: { entry: CarriedEntry }) {
  const count = entry.evidenceDocumentIds.length;
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-4 text-[var(--color-text-secondary)]">
      <PaperclipIcon size={ICON_SIZE} aria-hidden />
      {count} {pluralize(count, "file", "files")}
      <InfoHint label={`File names for ${entry.componentName ?? FALLBACK_NAME}`}>
        <EntryFileNames entryId={entry.entryId} />
      </InfoHint>
    </span>
  );
}

/** The submit step: a panel of its own below the component table. */
export function CarriedEntriesPanel({ entries, facilityId }: { entries: readonly CarriedEntry[] | undefined; facilityId: string }) {
  if (!entries?.length) return null;
  return (
    <section aria-labelledby="carried-entries-title" className="flex flex-col bg-[var(--paper)] [border:var(--panel-border)]" data-carried-entries>
      <div className="flex flex-col gap-2 bg-[var(--sea)] px-16 py-10">
        <h3 id="carried-entries-title" className="body-small font-medium">{PANEL_TITLE}</h3>
        <span className="body-caption text-[var(--color-text-secondary)]">{PANEL_CAPTION}</span>
      </div>
      <div
        className={cn(ROW_GRID, "hidden px-16 py-8 body-small font-medium text-[var(--color-text-secondary)] md:grid [border-top:var(--row-divider)]")}
        aria-hidden
      >
        <span>Component</span>
        <span>Credit batch</span>
        <span>Date</span>
        <span>Figure</span>
        <span>Source</span>
      </div>
      <ul aria-label={PANEL_TITLE}>
        {entries.map((entry) => (
          <li key={entry.entryId} className={cn(ROW_GRID, "px-16 py-10 [border-top:var(--row-divider)]")} data-carried-entry>
            <span className="flex min-w-0 flex-col gap-2">
              <span className="body-small">{entry.componentName ?? FALLBACK_NAME}</span>
              <RecordedAfter entry={entry} facilityId={facilityId} newTab />
            </span>
            <span className="text-right font-mono body-small tabular-nums md:col-start-4 md:row-start-1 md:text-left">{formatFigure(entry.value)}</span>
            <span className="col-span-2 flex flex-wrap items-center gap-x-8 body-small md:col-span-1 md:col-start-2 md:row-start-1">
              <span className="text-[var(--color-text-secondary)] md:hidden">From</span>
              <BatchLink entry={entry} facilityId={facilityId} newTab />
              <span className="text-[var(--color-text-secondary)] md:hidden">{formatDayString(entry.occurredOn)}</span>
            </span>
            <span className="hidden body-small text-[var(--color-text-secondary)] md:col-start-3 md:row-start-1 md:block">{formatDayString(entry.occurredOn)}</span>
            <span className="col-span-2 flex flex-wrap items-center gap-x-8 gap-y-2 body-small text-[var(--color-text-secondary)] md:col-span-1 md:col-start-5 md:row-start-1">
              1 manual entry
              <Files entry={entry} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Removal sheet: its own section with the same facts and one state line. */
export function CarriedEntriesSection({ entries, facilityId, sent }: { entries: readonly CarriedEntry[] | undefined; facilityId: string; sent: boolean }) {
  if (!entries?.length) return null;
  return (
    <EntriesSection title={PANEL_TITLE} state={sent ? SHEET_STATE.sent : SHEET_STATE.draft}>
      {entries.map((entry) => (
        <EntryItem key={entry.entryId} entry={entry} facilityId={facilityId} lead="From" recordedAfter />
      ))}
    </EntriesSection>
  );
}

/**
 * A returned Removal's revision: late entries of its own credit batches that it
 * takes when it is resubmitted. The title names the Removal, so rows skip the
 * "Recorded after" line.
 */
export function RevisionLateEntriesSection({ entries, facilityId, removalCode }: { entries: readonly CarriedEntry[] | undefined; facilityId: string; removalCode: string }) {
  if (!entries?.length) return null;
  return (
    <EntriesSection title={`Recorded after ${removalCode} was sent`} state={REVISION_STATE} dataAttr="data-revision-late-entries">
      {entries.map((entry) => (
        <EntryItem key={entry.entryId} entry={entry} facilityId={facilityId} lead="In" recordedAfter={false} />
      ))}
    </EntriesSection>
  );
}

function EntriesSection({ title, state, dataAttr = "data-carried-entries", children }: { title: string; state: string; dataAttr?: string; children: ReactNode }) {
  return (
    <DetailSection title={title}>
      <ul className="flex flex-col" {...{ [dataAttr]: true }}>{children}</ul>
      <p className="body-small">{state}</p>
    </DetailSection>
  );
}

function EntryItem({ entry, facilityId, lead, recordedAfter }: { entry: CarriedEntry; facilityId: string; lead: string; recordedAfter: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-12 gap-y-4 border-t border-[var(--color-border-tertiary)] py-10 first:border-t-0" data-carried-entry>
      <span className="body-small font-medium">{entry.componentName ?? FALLBACK_NAME}</span>
      <span className="text-right font-mono body-small tabular-nums">{formatFigure(entry.value)}</span>
      <span className="col-span-2 body-small text-[var(--color-text-secondary)]">
        {lead} <BatchLink entry={entry} facilityId={facilityId} newTab={false} />, {formatDayString(entry.occurredOn)}.
      </span>
      {recordedAfter && <span className="col-span-2"><RecordedAfter entry={entry} facilityId={facilityId} newTab={false} /></span>}
      <span className="col-span-2 flex flex-col gap-2 body-caption text-[var(--color-text-secondary)] empty:hidden"><EntryFileNames entryId={entry.entryId} /></span>
    </li>
  );
}
