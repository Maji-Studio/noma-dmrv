"use client";

import { formatDateRange } from "@/lib/format-utils";
import {
  CertificateIcon,
  CheckCircleIcon,
  PencilSimpleIcon,
  TrashIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { RowActionsMenu, StatusBadge } from "@/components/ui";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

interface CreditBatchCardProps {
  creditBatch: CreditBatchWithRelations;
  /** Per-batch certification readiness (undefined while loading). */
  health?: CreditBatchHealthSummary;
  isHealthLoading?: boolean;
  onView: (creditBatch: CreditBatchWithRelations) => void;
  onEdit: (creditBatch: CreditBatchWithRelations) => void;
  onDelete: (creditBatchId: string) => void;
}

/**
 * Certification-readiness tag — the card-grain echo of the detail page's
 * submission gate and the removal readiness hint. Green when the batch's data
 * is complete enough to certify; amber with the open-issue count (incl. missing
 * application evidence) when not. Opening the card lands on the gate's detail.
 */
function CertReadinessTag({ health }: { health: CreditBatchHealthSummary }) {
  if (health.state === "ready") {
    return (
      <StatusBadge
        status="ready"
        label="Ready to certify"
        icon={<CheckCircleIcon size={14} weight="fill" />}
      />
    );
  }
  return (
    <StatusBadge
      status="pending"
      label={`${health.issueCount} ${health.issueCount === 1 ? "issue" : "issues"} open`}
      icon={<WarningIcon size={14} weight="fill" />}
    />
  );
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
  const hasPendingCo2e =
    (creditBatch.co2eStoredPreview?.missingInputs.length ?? 0) > 0;

  return (
    <article
      className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-border-primary)] cursor-pointer"
      onClick={() => onView(creditBatch)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: code badge + cert readiness. The lifecycle status column is
            deliberately absent — every batch sits at its DB default ("pending")
            with no transition path, so the badge answered nothing the readiness
            tag doesn't (QA 2026-07-21 F3). It returns when a real registry
            lifecycle (submitted/accepted/rejected) exists. */}
        <div className="flex items-start justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-dark-purple)]">
            <CertificateIcon size={12} weight="bold" />
            {creditBatch.code}
          </span>
          <div className="flex items-center gap-8">
            {health ? (
              <CertReadinessTag health={health} />
            ) : isHealthLoading ? (
              <StatusBadge status="pending" label="Checking readiness…" />
            ) : null}
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
        <div className="grid grid-cols-2 gap-12 border-t border-[var(--color-border-tertiary)] pt-20">
          <div className="flex flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Applied biochar
            </span>
            <span className="title-heading-3 leading-none">
              {creditBatch.appliedWeightTons != null
                ? `${creditBatch.appliedWeightTons.toFixed(2)} t`
                : "—"}
            </span>
          </div>
          <div className="flex flex-col gap-4">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              CO₂e stored
            </span>
            <span
              className={`title-heading-3 leading-none ${
                co2eStored != null ? "text-[var(--st-ok)]" : ""
              }`}
            >
              {co2eStored != null ? `${co2eStored.toFixed(2)} t` : "—"}
            </span>
          </div>
        </div>

        {hasPendingCo2e && (
          <div className="flex items-center justify-between border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] px-12 py-8">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              CO₂e preview
            </span>
            <span className="body-small font-medium text-[var(--color-text-secondary)]">
              Pending inputs
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {creditBatch.productionRunCount}{" "}
          {creditBatch.productionRunCount === 1
            ? "production run"
            : "production runs"}
        </span>
      </div>
    </article>
  );
}
