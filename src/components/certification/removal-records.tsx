/**
 * The Records section of the Removal sheet (#1554): each credit batch closed
 * by default; opened, four groups of records named by date, place and mass with
 * the code last as a quiet link. A group shows its first three by date, then
 * "Show all N" opens the rest in place and moves focus to the first new record.
 */
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { INLINE_HIT_AREA_FROM_SM } from "@/components/ui/touch-target";
import { useRemovalRecords } from "@/hooks/use-removal-records";
import type { RemovalBatchRecords, RemovalRecord } from "@/lib/certification/removal-records";
import { KG_PER_TONNE } from "@/lib/calculations/unit-conversions";
import { formatDateRange, formatDayString, formatTonnes } from "@/lib/format-utils";
import { TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { recordHref, type RecordKind } from "@/lib/record-links";
import { cn } from "@/lib/utils";

/** An open credit batch shows this many records per group before "Show all N". */
export const RECORDS_SHOWN_FIRST = 3;
const MASS_DIGITS = 1;

const RECORD_KIND_LINK: Record<RemovalRecord["kind"], RecordKind> = {
  productionRun: "productionRun",
  application: "application",
  delivery: "delivery",
  feedstock: "feedstock",
};

const TEXT_LINK = cn(
  "inline-flex min-h-44 shrink-0 items-center self-start body-small text-[var(--color-text-primary)] underline underline-offset-4 sm:min-h-0",
  INLINE_HIT_AREA_FROM_SM,
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
);
/** 44px tall on a phone, text height from sm; the sibling rows keep their own spacing, so targets never overlap. */
const PHONE_TARGET = "inline-flex min-h-44 items-center sm:min-h-0";
const ROW_DIVIDER = "[border-top:var(--row-divider)] first:[border-top:none]";

/** Biochar records say "dry biochar"; deliveries and feedstock say "wet" or "dry". */
function massWord(record: RemovalRecord): string {
  return record.basis === "dry" && (record.kind === "productionRun" || record.kind === "application") ? "dry biochar" : record.basis;
}

/** The record's day without the year the sheet header already gives: "Feb 1". */
function shortDay(date: string): string {
  return formatDayString(date).replace(/, \d{4}$/, "");
}

/** "3.2 t dry biochar", "3.2 t wet", with no-break spaces so a phone never splits the mass. */
export function recordMassText(record: RemovalRecord): string | null {
  if (record.massKg == null) return null;
  return `${formatTonnes(record.massKg / KG_PER_TONNE, { digits: MASS_DIGITS })} ${massWord(record)}`.replace(/ /g, "\u00a0");
}

function RecordLine({ record, facilityId }: { record: RemovalRecord; facilityId: string }) {
  const mass = recordMassText(record);
  const href = recordHref(RECORD_KIND_LINK[record.kind], record.id, { facilityId });
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-12 py-4 body-small" data-removal-record>
      <span>
        <span className="tabular-nums">{shortDay(record.date)}</span>
        {record.place && <> · {record.place}</>}
        {mass && <> · <span className="tabular-nums">{mass}</span></>}
      </span>
      <Link href={href} className={cn(RECORD_CODE_LINK, PHONE_TARGET, "text-[length:var(--text-xs)]")}>
        {record.code}
      </Link>
    </li>
  );
}

export function RecordGroup({ title, records, facilityId }: { title: string; records: RemovalRecord[]; facilityId: string }) {
  const [showAll, setShowAll] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  if (records.length === 0) return null;
  const hidden = records.length - RECORDS_SHOWN_FIRST;
  const shown = showAll || hidden <= 0 ? records : records.slice(0, RECORDS_SHOWN_FIRST);

  function revealRest() {
    flushSync(() => setShowAll(true));
    listRef.current?.querySelectorAll("a")[RECORDS_SHOWN_FIRST]?.focus();
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="body-small font-medium">{title}</h3>
      <ul ref={listRef} className="flex flex-col">
        {shown.map((record) => (
          <RecordLine key={record.id} record={record} facilityId={facilityId} />
        ))}
      </ul>
      {!showAll && hidden > 0 && (
        <button type="button" onClick={revealRest} className={TEXT_LINK}>
          Show all {records.length}
          <span className="sr-only"> {title.toLowerCase()}</span>
        </button>
      )}
    </div>
  );
}

/** The batch's applied dry biochar; null when it has no application or one has no dry mass. */
function batchDryKg(batch: RemovalBatchRecords): number | null {
  const masses = batch.applications.map((record) => record.massKg);
  return masses.length > 0 && masses.every((kg): kg is number => kg != null) ? masses.reduce((sum, kg) => sum + kg, 0) : null;
}

/** `summarize`: with several batches the row tells them apart by dates and dry mass; a lone batch repeats the Removal's own figures. */
function BatchRow({ batch, facilityId, summarize }: { batch: RemovalBatchRecords; facilityId: string; summarize: boolean }) {
  const [open, setOpen] = useState(false);
  const dryKg = batchDryKg(batch);
  return (
    <li className={cn("flex flex-col", ROW_DIVIDER)}>
      <div className="flex items-center gap-12">
        <Link href={recordHref("creditBatch", batch.creditBatchId, { facilityId })} className={cn(RECORD_CODE_LINK, PHONE_TARGET, "shrink-0")}>
          {batch.code}
        </Link>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex min-h-44 min-w-0 flex-1 items-center gap-12 text-left body-small focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          <span className="sr-only">Records of {batch.code}, </span>
          {summarize ? (
            <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-16 text-[var(--color-text-secondary)]">
              <span className="whitespace-nowrap">{formatDateRange(batch.startDate, batch.endDate)}</span>
              {dryKg != null && <span className="whitespace-nowrap tabular-nums">{formatTonnes(dryKg / KG_PER_TONNE, { digits: MASS_DIGITS })} dry</span>}
            </span>
          ) : (
            <span className="flex-1" />
          )}
          <CaretDownIcon size={16} aria-hidden className={cn("shrink-0 text-[var(--color-text-tertiary)] transition-transform", !open && "-rotate-90")} />
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-12 pt-4 pb-16">
          <RecordGroup title="Production runs" records={batch.productionRuns} facilityId={facilityId} />
          <RecordGroup title="Applications" records={batch.applications} facilityId={facilityId} />
          <RecordGroup title="Deliveries" records={batch.deliveries} facilityId={facilityId} />
          <RecordGroup title="Feedstock intake" records={batch.feedstock} facilityId={facilityId} />
        </div>
      )}
    </li>
  );
}

export function RemovalRecordsList({ batches, facilityId }: { batches: RemovalBatchRecords[]; facilityId: string }) {
  if (batches.length === 0) {
    return <p className="body-small text-[var(--color-text-secondary)]">No credit batches yet. Records appear here once this Removal holds one.</p>;
  }
  return (
    <ul className="flex flex-col">
      {batches.map((batch) => (
        <BatchRow key={batch.creditBatchId} batch={batch} facilityId={facilityId} summarize={batches.length > 1} />
      ))}
    </ul>
  );
}

export function RemovalRecords({ removalId, facilityId, enabled }: { removalId: string; facilityId: string; enabled: boolean }) {
  const query = useRemovalRecords(removalId, { enabled });
  if (query.isLoading) return <div role="status" aria-busy="true" aria-label="Loading records"><Skeleton className="h-96 w-full" /></div>;
  if (query.isError || !query.data) {
    return (
      <Notice
        tone="error"
        action={<Button variant="weak" size="small" busy={query.isFetching} onClick={() => void query.refetch()}>{TRY_AGAIN_LABEL}</Button>}
      >
        These records could not be loaded.
      </Notice>
    );
  }
  return <RemovalRecordsList batches={query.data} facilityId={facilityId} />;
}
