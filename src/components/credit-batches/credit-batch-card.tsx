"use client";

import { formatSafeDate } from "@/lib/format-utils";
import {
  Certificate,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import {
  formatCreditBatchStatus,
  formatDurabilityOption,
  getStatusColor,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";

interface CreditBatchCardProps {
  creditBatch: CreditBatchWithRelations;
  onView: (creditBatch: CreditBatchWithRelations) => void;
  onEdit: (creditBatch: CreditBatchWithRelations) => void;
  onDelete: (creditBatchId: string) => void;
}

export function CreditBatchCard({
  creditBatch,
  onView,
  onEdit,
  onDelete,
}: CreditBatchCardProps) {
  const statusColors = getStatusColor(creditBatch.status as CreditBatchStatus);

  const netCo2eRemoval =
    creditBatch.totalCo2eStoredTons != null
      ? creditBatch.totalCo2eStoredTons -
        (creditBatch.totalCo2eEmissionsTons ?? 0) -
        (creditBatch.totalCo2eCounterfactualTons ?? 0)
      : null;

  return (
    <article
      className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] transition-colors hover:border-[var(--color-border-primary)] cursor-pointer"
      onClick={() => onView(creditBatch)}
    >
      <div className="flex flex-1 flex-col gap-16 p-20">
        {/* Header: code badge + status */}
        <div className="flex items-center justify-between gap-12">
          <span className="inline-flex items-center gap-6 border border-[var(--clr-dark-purple-20)] bg-[var(--clr-dark-purple-10)] px-10 py-4 text-[11px] uppercase tracking-[0.12em] text-[var(--clr-dark-purple)]">
            <Certificate size={12} weight="bold" />
            {creditBatch.code}
          </span>
          <span
            className={`px-8 py-4 text-[var(--text-xs)] font-medium ${statusColors.bg} ${statusColors.text}`}
          >
            {formatCreditBatchStatus(creditBatch.status as CreditBatchStatus)}
          </span>
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
              CO2e Stored
            </p>
            <p
              className={`title-heading-3 ${
                creditBatch.totalCo2eStoredTons != null
                  ? "text-[var(--color-signal-green)]"
                  : ""
              }`}
            >
              {creditBatch.totalCo2eStoredTons != null
                ? `${creditBatch.totalCo2eStoredTons.toFixed(2)} t`
                : "—"}
            </p>
          </div>
        </div>

        {/* Net removal line */}
        {netCo2eRemoval != null && creditBatch.totalCo2eStoredTons != null && (
          <div className="flex items-center justify-between border border-[var(--color-border-tertiary)] bg-[var(--color-surface-light)] px-12 py-8">
            <span className="body-caption text-[var(--color-text-tertiary)]">
              Net CO2e Removal
            </span>
            <span className="body-small font-medium text-[var(--color-signal-green)]">
              {netCo2eRemoval.toFixed(2)} t
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
          {(creditBatch.applicationCount ?? 0) > 0 && (
            <span>{creditBatch.applicationCount} applications</span>
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
          >
            <Trash size={16} />
          </Button>
        </div>
      </div>
    </article>
  );
}
