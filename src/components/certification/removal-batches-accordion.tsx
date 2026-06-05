/**
 * RemovalBatchesAccordion — the cross-link surface for GHG-statement removals.
 *
 * Removals are abstract on their own (an `rmv_…` id and a date), so both the
 * create-preview and the statement detail view render them as an accordion:
 * the trigger shows the removal's registry id + completion date (+ an optional
 * status badge), and the panel reveals the credit batches grouped into it plus
 * a link that opens the removal's full review page in a new tab. That gives the
 * operator the "click to understand, and to amend" path — editing a removal and
 * resubmitting is how a submitted statement's contents are changed (there is no
 * undo; membership itself is server-derived by date range, ADR 0004).
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { Accordion } from "@/components/ui/accordion";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatTonnes } from "@/lib/format-utils";
import { formatCreditBatchStatus } from "@/schemas/credit-batches";
import type { RemovalCreditBatchSummary } from "@/fn/certification/ghg-statements";

export interface RemovalAccordionEntry {
  removalId: string;
  /** Registry id (rmv_…) or a short local id fallback. */
  label: string;
  completedOn: string | null;
  creditBatches: RemovalCreditBatchSummary[];
  /** Optional status badge rendered in the trigger (statement detail view). */
  badge?: ReactNode;
}

interface RemovalBatchesAccordionProps {
  entries: RemovalAccordionEntry[];
  /** Facility scope carried onto the removal-review deep link. */
  facilityId: string;
}

// The removal's full detail lives in the guided Review flow; open it in a new
// tab so the operator keeps their place in the statement.
function removalReviewHref(removalId: string, facilityId: string): string {
  return `/certification/removals/${removalId}/review?facility=${encodeURIComponent(facilityId)}`;
}

export function RemovalBatchesAccordion({
  entries,
  facilityId,
}: RemovalBatchesAccordionProps) {
  return (
    <Accordion.Root className="gap-8">
      {entries.map((entry) => (
        <Accordion.Item key={entry.removalId} value={entry.removalId}>
          <Accordion.Header>
            <Accordion.Trigger className="px-12 py-8">
              <span className="flex min-w-0 items-center gap-8 normal-case tracking-normal">
                <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
                  {entry.label}
                </span>
                {entry.completedOn && (
                  <span className="body-caption text-[var(--color-text-tertiary)] shrink-0">
                    {entry.completedOn}
                  </span>
                )}
                {entry.badge}
              </span>
            </Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="px-12 py-12">
            <div className="flex flex-col gap-12">
              <Link
                href={removalReviewHref(entry.removalId, facilityId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-4 body-caption font-medium text-[var(--color-interaction)] hover:underline w-fit"
              >
                Open removal
                <ArrowSquareOut size={12} weight="bold" aria-hidden />
              </Link>

              <div className="flex flex-col gap-6">
                <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  Credit batches ({entry.creditBatches.length})
                </span>
                {entry.creditBatches.length === 0 ? (
                  <p className="body-caption text-[var(--color-text-tertiary)]">
                    No credit batches grouped into this removal.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-4">
                    {entry.creditBatches.map((batch) => (
                      <li
                        key={batch.id}
                        className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-8 py-6"
                      >
                        <span className="flex min-w-0 flex-col gap-1">
                          <span className="body-caption font-mono text-[var(--color-text-primary)] truncate">
                            {batch.code}
                          </span>
                          <span className="body-caption text-[var(--color-text-tertiary)]">
                            {batch.startDate} → {batch.endDate}
                            {batch.totalCo2eStoredTons != null &&
                              ` · ${formatTonnes(batch.totalCo2eStoredTons, {
                                unit: "t CO₂e",
                              })}`}
                          </span>
                        </span>
                        <StatusBadge
                          status={batch.status}
                          label={formatCreditBatchStatus(batch.status)}
                          size="small"
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}
