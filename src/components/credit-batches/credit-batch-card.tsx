"use client";

import { formatDateRange } from "@/lib/format-utils";
import {
  CertificateIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu } from "@/components/ui";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { CreditBatchLifecycleRail } from "./credit-batch-lifecycle";

interface CreditBatchCardProps {
  creditBatch: CreditBatchWithRelations;
  /** Per-batch data readiness plus Removal / GHG Statement progress. */
  health?: CreditBatchHealthSummary;
  isHealthLoading?: boolean;
  onView: (creditBatch: CreditBatchWithRelations) => void;
  onEdit: (creditBatch: CreditBatchWithRelations) => void;
  onDelete: (creditBatchId: string) => void;
}

export function CreditBatchCard({
  creditBatch,
  health,
  isHealthLoading = false,
  onView,
  onEdit,
  onDelete,
}: CreditBatchCardProps) {
  const co2eStored = creditBatch.co2eStoredPreview?.co2eStoredTonnes ?? null;

  return (
    <article
      className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-border-primary)] cursor-pointer"
      onClick={() => onView(creditBatch)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* The lifecycle lives in the footer rail; keep the header to identity
            and actions so status is expressed only once. */}
        <div className="flex items-start justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-dark-purple)]">
            <CertificateIcon size={12} weight="bold" />
            {creditBatch.code}
          </span>
          <RowActionsMenu
            label={`Actions for credit batch ${creditBatch.code}`}
            actions={[
              {
                label: "Edit",
                icon: <PencilSimpleIcon size={16} />,
                onSelect: () => onEdit(creditBatch),
              },
              {
                label: "Delete",
                destructive: true,
                icon: <TrashIcon size={16} />,
                onSelect: () => onDelete(creditBatch.id),
              },
            ]}
          />
        </div>

        {/* Feedstock is the production cohort's identity; facility is already
            fixed by the page context and deliberately not repeated here. */}
        <div className="flex flex-col gap-4">
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {creditBatch.feedstockTypeName ?? "Feedstock not set"}
          </h3>
          <p className="body-small text-[var(--color-text-secondary)]">
            {formatDateRange(creditBatch.startDate, creditBatch.endDate)}
          </p>
        </div>

        {/* Certification-relevant outputs */}
        <div
          className={`grid gap-12 border-t border-[var(--color-border-tertiary)] pt-20 ${
            co2eStored != null ? "grid-cols-3" : "grid-cols-2"
          }`}
        >
          <div className="flex flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Production runs
            </span>
            <span className="title-heading-3 leading-none tabular-nums">
              {creditBatch.productionRunCount}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Applied biochar
            </span>
            <span className="title-heading-3 leading-none">
              {creditBatch.appliedWeightTons != null
                ? `${creditBatch.appliedWeightTons.toFixed(2)} t`
                : "Not recorded"}
            </span>
          </div>
          {co2eStored != null && (
            <div className="flex flex-col gap-4">
              <span className="body-caption text-[var(--color-text-tertiary)]">
                CO₂e stored
              </span>
              <span className="title-heading-3 leading-none text-[var(--st-ok)]">
                {co2eStored.toFixed(2)} t
              </span>
            </div>
          )}
        </div>
      </div>

      {/* The ordered certification journey is the card's signature footer. */}
      <div className="border-t border-[var(--color-border-tertiary)] px-20 py-12">
        {health ? (
          <CreditBatchLifecycleRail summary={health} />
        ) : (
          <span
            className="body-caption text-[var(--color-text-tertiary)]"
            aria-busy={isHealthLoading || undefined}
          >
            {isHealthLoading
              ? "Loading certification progress…"
              : "Certification progress unavailable"}
          </span>
        )}
      </div>
    </article>
  );
}
