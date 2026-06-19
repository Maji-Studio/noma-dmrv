"use client";

import { formatSafeDate } from "@/lib/format-utils";
import {
  Certificate,
  CheckCircle,
  PencilSimple,
  Trash,
  Warning,
} from "@phosphor-icons/react/dist/ssr";
import { Button, StatusBadge } from "@/components/ui";
import {
  formatCreditBatchStatus,
  formatDurabilityOption,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchHealthSummary } from "@/fn/certification";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

interface CreditBatchCardProps {
  creditBatch: CreditBatchWithRelations;
  /** Per-batch certification readiness (undefined while loading). */
  health?: CreditBatchHealthSummary;
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
      <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-green)]">
        <CheckCircle size={14} weight="fill" aria-hidden />
        Ready to certify
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-4 body-caption text-[var(--color-signal-orange)]">
      <Warning size={14} weight="fill" aria-hidden />
      {health.issueCount} cert {health.issueCount === 1 ? "gap" : "gaps"}
    </span>
  );
}

export function CreditBatchCard({
  creditBatch,
  health,
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
        {/* Header: code badge + lifecycle status / cert readiness */}
        <div className="flex items-start justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-dark-purple)]">
            <Certificate size={12} weight="bold" />
            {creditBatch.code}
          </span>
          <div className="flex flex-col items-end gap-6">
            <StatusBadge
              status={creditBatch.status as CreditBatchStatus}
              label={formatCreditBatchStatus(
                creditBatch.status as CreditBatchStatus
              )}
            />
            {health && <CertReadinessTag health={health} />}
          </div>
        </div>

        {/* Crediting period + facility */}
        <div>
          <h3 className="title-heading-3 text-[var(--color-text-primary)]">
            {formatSafeDate(creditBatch.startDate)} —{" "}
            {formatSafeDate(creditBatch.endDate)}
          </h3>
          <p className="mt-6 body-caption text-[var(--color-text-tertiary)]">
            {creditBatch.facility?.name ?? "No facility"}
          </p>
        </div>

        {/* 3-col metrics */}
        <div className="grid grid-cols-3 gap-12">
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Durability
            </p>
            <p className="body-small text-[var(--color-text-primary)]">
              {creditBatch.durabilityOption
                ? formatDurabilityOption(
                    creditBatch.durabilityOption as DurabilityOption
                  )
                : "—"}
            </p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              Weight
            </p>
            <p className="title-heading-3">
              {creditBatch.weightTons != null
                ? `${creditBatch.weightTons.toFixed(2)} t`
                : "—"}
            </p>
          </div>
          <div>
            <p className="body-caption text-[var(--color-text-tertiary)]">
              CO₂e stored
            </p>
            <p
              className={`title-heading-3 ${
                co2eStored != null
                  ? "text-[var(--color-signal-green)]"
                  : ""
              }`}
            >
              {co2eStored != null ? `${co2eStored.toFixed(2)} t` : "—"}
            </p>
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

        {/* Value + secondary counts */}
        <div className="flex items-center gap-16 body-caption text-[var(--color-text-tertiary)]">
          {creditBatch.value != null && (
            <span>
              {creditBatch.value.toLocaleString()}{" "}
              {creditBatch.currency ?? ""}
            </span>
          )}
          {(creditBatch.productionRunCount ?? 0) > 0 && (
            <span>{creditBatch.productionRunCount} production runs</span>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-12 border-t border-[var(--color-border-tertiary)] px-20 py-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {creditBatch.certifier ?? "No certifier"}
        </span>

        <div
          className="flex items-center gap-8"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="small"
            variant="default"
            onClick={() => onEdit(creditBatch)}
          >
            <PencilSimple size={16} />
            Edit
          </Button>
          <Button
            size="small"
            variant="default"
            className="border-[var(--color-signal-red)] text-[var(--color-signal-red)] hover:bg-[var(--clr-red-10)]"
            onClick={() => onDelete(creditBatch.id)}
            aria-label={`Delete credit batch ${creditBatch.code}`}
          >
            <Trash size={16} />
          </Button>
        </div>
      </div>
    </article>
  );
}
