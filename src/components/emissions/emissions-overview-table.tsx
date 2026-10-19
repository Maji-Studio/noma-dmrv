/**
 * The Emissions overview's table: credit batches × line states, sortable
 * headers, a sticky header on desktop. A row opens the batch; the code link in
 * the first cell is the keyboard target and stops the row's own click.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CaretDownIcon, CaretUpIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui";
import type { EmissionLineCounts, FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import { EMISSION_LINE_STATE_LABELS, type EmissionLineState } from "@/lib/certification/emission-lines";
import { formatDateRange } from "@/lib/format-utils";
import { creditBatchStatuses, type CreditBatchStatus } from "@/schemas/credit-batches";
import { cn } from "@/lib/utils";
import {
  BATCH_SORT_LABELS,
  emissionsBatchHref,
  type BatchSort,
  type EmissionsOverviewQuery,
} from "./emissions-overview-query";

/** The open states the table counts, in reading order, with their count field. */
const COUNT_COLUMNS: readonly { state: EmissionLineState; count: keyof EmissionLineCounts }[] = [
  { state: "needsReview", count: "needsReview" },
  { state: "missingEvidence", count: "fileMissing" },
  { state: "empty", count: "notRecorded" },
  { state: "needsSetup", count: "needsSetup" },
];
const NO_LINES_TEXT = "No lines";

const TH =
  "px-16 py-10 font-medium text-left whitespace-nowrap bg-[var(--sea)] lg:sticky lg:top-0 lg:z-[1] lg:[box-shadow:inset_0_-1px_0_var(--color-border-tertiary)]";
const TD = "px-16 py-12";

function isCreditBatchStatus(status: string): status is CreditBatchStatus {
  return (creditBatchStatuses as readonly string[]).includes(status);
}

export function batchPeriodText(batch: Pick<FacilityEmissionsOverviewBatch, "startDate" | "endDate">): string {
  return formatDateRange(batch.startDate, batch.endDate);
}

interface EmissionsOverviewTableProps {
  rows: FacilityEmissionsOverviewBatch[];
  query: EmissionsOverviewQuery;
  facilityId: string;
  onSort: (sort: BatchSort) => void;
}

export function EmissionsOverviewTable({ rows, query, facilityId, onSort }: EmissionsOverviewTableProps) {
  const router = useRouter();
  return (
    <div className="overflow-x-auto lg:overflow-visible">
      <table className="w-full body-small" aria-label="Credit batches by line state">
        <thead className="text-[var(--color-text-secondary)]">
          <tr>
            <SortHeader sort="code" query={query} onSort={onSort} />
            <SortHeader sort="period" query={query} onSort={onSort} className="hidden xl:table-cell" />
            <th scope="col" className={cn(TH, "hidden sm:table-cell")}>Status</th>
            {COUNT_COLUMNS.map(({ state }) => (
              <th key={state} scope="col" className={cn(TH, "hidden text-right lg:table-cell")}>
                {EMISSION_LINE_STATE_LABELS[state]}
              </th>
            ))}
            <SortHeader sort="open" query={query} onSort={onSort} className="text-right" label="Open" />
          </tr>
        </thead>
        <tbody>
          {rows.map((batch) => {
            const href = emissionsBatchHref(batch.creditBatchId, { ...query, facility: facilityId });
            return <BatchRow key={batch.creditBatchId} batch={batch} href={href} onOpen={() => router.push(href)} />;
          })}
        </tbody>
      </table>
    </div>
  );
}

interface SortHeaderProps {
  sort: BatchSort;
  query: EmissionsOverviewQuery;
  onSort: (sort: BatchSort) => void;
  className?: string;
  label?: string;
}

function SortHeader({ sort, query, onSort, className, label }: SortHeaderProps) {
  const active = sort === query.sort;
  const asc = active && query.dir === "asc";
  const desc = active && query.dir === "desc";
  const alignEnd = className?.includes("text-right");
  return (
    <th
      scope="col"
      aria-sort={active ? (asc ? "ascending" : "descending") : undefined}
      className={cn(TH, "p-0", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sort)}
        className={cn(
          "inline-flex min-h-44 w-full items-center gap-4 px-16 font-medium hover:bg-[var(--clr-dark-purple-5)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-interaction)]",
          alignEnd && "justify-end",
        )}
      >
        {label ?? BATCH_SORT_LABELS[sort]}
        <span className="inline-flex flex-col leading-none text-[var(--color-text-tertiary)]" aria-hidden="true">
          <CaretUpIcon size={10} weight={asc ? "fill" : "regular"} className={asc ? "text-[var(--color-interaction)]" : undefined} />
          <CaretDownIcon size={10} weight={desc ? "fill" : "regular"} className={desc ? "text-[var(--color-interaction)]" : undefined} />
        </span>
      </button>
    </th>
  );
}

function BatchRow({ batch, href, onOpen }: { batch: FacilityEmissionsOverviewBatch; href: string; onOpen: () => void }) {
  const counts = batch.lineCounts;
  const period = batchPeriodText(batch);
  const flags = COUNT_COLUMNS.filter(({ count }) => counts[count] > 0).map(
    ({ state, count }) => `${counts[count]} ${EMISSION_LINE_STATE_LABELS[state].toLowerCase()}`,
  );
  const hasLines = counts.total > 0;
  return (
    <tr onClick={onOpen} className="cursor-pointer [border-top:var(--row-divider)] hover:bg-[var(--row-hover-bg-solid)]">
      <td className={TD}>
        <Link
          href={href}
          onClick={(event) => event.stopPropagation()}
          className="font-medium text-[var(--acc-dist-ink)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
        >
          {batch.code}
        </Link>
        <span className="block body-caption text-[var(--color-text-tertiary)] xl:hidden">{period}</span>
        {flags.length > 0 && (
          <span className="block body-caption text-[var(--color-text-secondary)] lg:hidden">{flags.join(", ")}</span>
        )}
      </td>
      <td className={cn(TD, "hidden whitespace-nowrap xl:table-cell")}>{period}</td>
      <td className={cn(TD, "hidden sm:table-cell")}>
        {isCreditBatchStatus(batch.status) ? <StatusBadge status={batch.status} size="small" /> : batch.status}
      </td>
      {COUNT_COLUMNS.map(({ state, count }) => (
        <td
          key={state}
          className={cn(TD, "hidden text-right tabular-nums lg:table-cell", !counts[count] && "text-[var(--color-text-tertiary)]")}
        >
          {counts[count]}
        </td>
      ))}
      <td
        className={cn(
          TD,
          "whitespace-nowrap text-right font-medium tabular-nums",
          (!counts.open || !hasLines) && "font-normal text-[var(--color-text-tertiary)]",
        )}
      >
        {hasLines ? `${counts.open} of ${counts.total}` : NO_LINES_TEXT}
      </td>
    </tr>
  );
}
