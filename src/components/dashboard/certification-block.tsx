/**
 * CertificationBlock — the registry summary pulled out of the hero scene into
 * its own quiet panel: batch total + pending chip in the head, the latest
 * batches with their status ramp, and the classic blocker (batches without
 * samples) called out when present.
 */
"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge } from "@/components/ui/status-badge";
import type { DashboardCertification } from "@/data-access/dashboard-overview";
import { DashboardPanel } from "./dashboard-panel";

interface CertificationBlockProps {
  certification: DashboardCertification;
  facilityId: string;
}

export function CertificationBlock({
  certification,
  facilityId,
}: CertificationBlockProps) {
  const { totalBatches, pendingBatches, batches, batchesWithoutSamples } =
    certification;

  return (
    <DashboardPanel
      title="Certification — credit batches"
      meta={
        pendingBatches > 0 ? (
          <span className="label-micro text-[var(--st-wait)]">
            {pendingBatches} pending
          </span>
        ) : (
          <span className="label-micro text-[var(--color-text-tertiary)]">
            {totalBatches} {totalBatches === 1 ? "batch" : "batches"}
          </span>
        )
      }
    >
      {batches.length === 0 ? (
        <div className="px-20 py-20">
          <span className="body-small text-[var(--color-text-secondary)]">
            No credit batches yet — create one to roll a period&apos;s removals
            toward the registry.
          </span>
        </div>
      ) : (
        <ul className="flex flex-col px-20 py-4" data-testid="certification-batches">
          {batches.map((batch, index) => (
            <li
              key={batch.id}
              className={
                index > 0 ? "border-t border-[var(--color-border-tertiary)]" : undefined
              }
            >
              <Link
                href={`/credit-batches/${batch.id}`}
                className="group grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-12 py-12"
              >
                <span className="font-mono text-[12px] tabular-nums text-[var(--color-text-primary)]">
                  {batch.code}
                </span>
                <StatusBadge status={batch.status} size="small" />
                <ArrowRightIcon
                  size={14}
                  weight="bold"
                  className="text-[var(--color-text-tertiary)] transition-transform duration-150 group-hover:translate-x-[3px]"
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {batchesWithoutSamples > 0 && (
        <div className="border-t border-[var(--color-border-tertiary)] px-20 py-10">
          <span className="body-caption text-[var(--st-wait)]">
            {batchesWithoutSamples}{" "}
            {batchesWithoutSamples === 1 ? "batch" : "batches"} blocked — no lab
            samples pooled yet
          </span>
        </div>
      )}

      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-14">
        <Link
          href={`/certification/removals?facility=${encodeURIComponent(facilityId)}`}
          className="group inline-flex items-center gap-8 label-micro text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          Open certification removals
          <ArrowRightIcon
            size={13}
            weight="bold"
            className="transition-transform duration-150 group-hover:translate-x-[3px]"
            aria-hidden
          />
        </Link>
      </div>
    </DashboardPanel>
  );
}
