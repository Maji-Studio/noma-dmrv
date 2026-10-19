/**
 * Breadcrumb back to the (still filtered) Emissions overview, and the
 * previous / next credit batch in the overview's filter and sort, with the
 * `[` and `]` keys (never while typing or while a dialog is open).
 */
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import type { FacilityEmissionsOverviewBatch } from "@/hooks/use-emissions-overview";
import {
  emissionsBatchHref,
  emissionsOverviewHref,
  filterAndSortBatches,
  sortBatches,
  type EmissionsOverviewQuery,
} from "./emissions-overview-query";
import { lineQueryParams } from "./batch-emissions-query";
import type { LineFilter, LineSort } from "./emission-line-display";

const PAGER_LINK =
  "inline-flex min-h-44 min-w-44 items-center justify-center gap-6 px-8 body-small font-medium text-[var(--color-text-interaction-primary)] hover:bg-[var(--color-surface-medium)]";
const PAGER_OFF = "inline-flex min-h-44 min-w-44 items-center justify-center px-8 text-[var(--color-text-tertiary)]";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

interface BatchEmissionsTopBarProps {
  code: string;
  creditBatchId: string;
  facilityId: string;
  batches: readonly FacilityEmissionsOverviewBatch[];
  query: EmissionsOverviewQuery;
  /** The facility's calendar day, YYYY-MM-DD: the overview's period presets resolve on it. */
  today: string;
  lineFilter: LineFilter | null;
  lineSort: LineSort;
}

export function BatchEmissionsTopBar({ code, creditBatchId, facilityId, batches, query, today, lineFilter, lineSort }: BatchEmissionsTopBarProps) {
  const router = useRouter();
  const filtered = filterAndSortBatches(batches, query, today);
  const inFilter = filtered.some((batch) => batch.creditBatchId === creditBatchId);
  // A batch outside the overview filter (a deep link) walks every batch instead.
  const list = inFilter ? filtered : sortBatches(batches, query.sort, query.dir);
  const index = list.findIndex((batch) => batch.creditBatchId === creditBatchId);
  const prev = index > 0 ? list[index - 1] : null;
  const next = index >= 0 && index < list.length - 1 ? list[index + 1] : null;
  const lineParams = lineQueryParams(lineFilter, lineSort);
  const hrefFor = (batch: FacilityEmissionsOverviewBatch) => {
    const href = emissionsBatchHref(batch.creditBatchId, { ...query, facility: facilityId });
    const extra = lineParams.toString();
    return extra ? `${href}${href.includes("?") ? "&" : "?"}${extra}` : href;
  };
  const prevHref = prev ? hrefFor(prev) : null;
  const nextHref = next ? hrefFor(next) : null;

  // External-system sync: a window key listener for [ and ].
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target) || document.querySelector("[role=dialog]")) return;
      if (event.key === "[" && prevHref) router.push(prevHref, { scroll: false });
      if (event.key === "]" && nextHref) router.push(nextHref, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-16 gap-y-4">
      <nav aria-label="Breadcrumb" className="body-small text-[var(--color-text-secondary)]">
        <ol className="flex items-center gap-6">
          <li>
            <Link
              href={emissionsOverviewHref({ ...query, facility: facilityId })}
              className="inline-flex min-h-44 items-center underline underline-offset-4 hover:text-[var(--color-text-primary)]"
            >
              Emissions
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-[var(--color-text-primary)]">{code}</li>
        </ol>
      </nav>
      {index >= 0 && (
        <nav aria-label="Credit batches" className="flex items-center gap-4">
          {prev && prevHref ? (
            <Link href={prevHref} scroll={false} className={PAGER_LINK} aria-label={`Previous credit batch, ${prev.code}`} aria-keyshortcuts="[">
              <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
              <span className="hidden sm:inline">{prev.code}</span>
            </Link>
          ) : (
            <span className={PAGER_OFF} aria-hidden="true"><ArrowLeftIcon size={16} weight="bold" /></span>
          )}
          <span
            className="whitespace-nowrap px-4 body-caption tabular-nums text-[var(--color-text-secondary)]"
            title={inFilter ? "Position in the filtered overview" : "Not in the overview filter, so this walks every credit batch"}
          >
            {`${index + 1} of ${list.length}${inFilter ? "" : " (all)"}`}
          </span>
          {next && nextHref ? (
            <Link href={nextHref} scroll={false} className={PAGER_LINK} aria-label={`Next credit batch, ${next.code}`} aria-keyshortcuts="]">
              <span className="hidden sm:inline">{next.code}</span>
              <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
            </Link>
          ) : (
            <span className={PAGER_OFF} aria-hidden="true"><ArrowRightIcon size={16} weight="bold" /></span>
          )}
        </nav>
      )}
    </div>
  );
}
