/**
 * CreditBatchCard component
 * Displays a single credit batch record with key details
 */
"use client";

import { format, isValid, parseISO } from "date-fns";
import {
  PencilSimple,
  Trash,
  Leaf,
  Certificate,
  ChartLine,
  CurrencyCircleDollar,
} from "@phosphor-icons/react/dist/ssr";
import {
  formatCreditBatchStatus,
  formatDurabilityOption,
  getStatusColor,
  type CreditBatchStatus,
  type DurabilityOption,
} from "@/schemas/credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import {
  ViewRelatedGroup,
  FacilityLink,
  ApplicationLink,
} from "@/components/ui/view-related-link";

interface CreditBatchCardProps {
  creditBatch: CreditBatchWithRelations;
  onEdit?: (creditBatch: CreditBatchWithRelations) => void;
  onDelete?: (creditBatchId: string) => void;
}

export function CreditBatchCard({
  creditBatch,
  onEdit,
  onDelete,
}: CreditBatchCardProps) {
  const statusColors = getStatusColor(creditBatch.status as CreditBatchStatus);

  const formatSafeDate = (dateStr: string | Date) => {
    const date = typeof dateStr === "string" ? parseISO(dateStr) : dateStr;
    return isValid(date) ? format(date, "MMM d, yyyy") : "Invalid date";
  };

  // Calculate net CO2e removal
  const netCo2eRemoval =
    creditBatch.totalCo2eStoredTons != null
      ? creditBatch.totalCo2eStoredTons -
        (creditBatch.totalCo2eEmissionsTons ?? 0) -
        (creditBatch.totalCo2eCounterfactualTons ?? 0)
      : null;

  return (
    <div className="border border-[var(--color-border-primary)] rounded-[var(--radius-8)] p-24 bg-[var(--color-background-light)] hover:border-[var(--color-border-secondary)] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between mb-16">
        <div>
          <h3 className="title-heading-4 mb-16">{creditBatch.code}</h3>
          <p className="body-small text-[var(--color-text-secondary)]">
            {creditBatch.facility?.name ?? "No facility"}
          </p>
        </div>
        <div className="flex items-center gap-16">
          <span
            className={`px-16 py-16 rounded-[var(--radius-4)] text-[var(--text-xs)] font-medium ${statusColors.bg} ${statusColors.text}`}
          >
            {formatCreditBatchStatus(creditBatch.status as CreditBatchStatus)}
          </span>
        </div>
      </div>

      {/* Date Range */}
      <div className="mb-16 p-16 bg-[var(--color-surface-light)] rounded-[var(--radius-4)]">
        <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase mb-16">
          Crediting Period
        </p>
        <p className="body-medium">
          {formatSafeDate(creditBatch.startDate)} —{" "}
          {formatSafeDate(creditBatch.endDate)}
        </p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-16 mb-16">
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase flex items-center gap-16">
            <Leaf size={14} />
            Durability
          </p>
          <p className="body-medium font-medium">
            {formatDurabilityOption(
              creditBatch.durabilityOption as DurabilityOption
            )}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase flex items-center gap-16">
            <Certificate size={14} />
            Applications
          </p>
          <p className="body-medium font-medium">
            {creditBatch.applicationCount ?? 0}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase flex items-center gap-16">
            <ChartLine size={14} />
            Weight
          </p>
          <p className="body-medium font-medium">
            {creditBatch.weightTons?.toFixed(2) ?? "-"} t
          </p>
        </div>
        <div>
          <p className="text-[var(--text-xs)] text-[var(--color-text-tertiary)] uppercase flex items-center gap-16">
            <CurrencyCircleDollar size={14} />
            Value
          </p>
          <p className="body-medium font-medium">
            {creditBatch.value?.toLocaleString() ?? "-"} {creditBatch.currency}
          </p>
        </div>
      </div>

      {/* Durability Details */}
      {creditBatch.durabilityOption === "200_year" &&
        creditBatch.hToCorgRatio != null && (
          <div className="mb-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
            <span className="font-medium">H:Corg Ratio:</span>{" "}
            {creditBatch.hToCorgRatio.toFixed(3)}
          </div>
        )}

      {creditBatch.durabilityOption === "1000_year" && (
        <div className="mb-16 text-[var(--text-s)] text-[var(--color-text-secondary)] space-y-16">
          {creditBatch.meanRandomReflectancePercent != null && (
            <div>
              <span className="font-medium">Mean R_0:</span>{" "}
              {creditBatch.meanRandomReflectancePercent.toFixed(2)}%
            </div>
          )}
          {creditBatch.meanNonReactiveCarbonPercent != null && (
            <div>
              <span className="font-medium">Non-Reactive Carbon:</span>{" "}
              {creditBatch.meanNonReactiveCarbonPercent.toFixed(2)}%
            </div>
          )}
        </div>
      )}

      {/* GHG Summary */}
      {(creditBatch.totalCo2eStoredTons != null || netCo2eRemoval != null) && (
        <div className="mb-16 p-16 bg-[var(--color-success-light)] rounded-[var(--radius-4)]">
          <div className="grid grid-cols-2 gap-16">
            {creditBatch.totalCo2eStoredTons != null && (
              <div>
                <p className="text-[var(--text-xs)] text-[var(--color-success)] font-medium">
                  CO2e Stored
                </p>
                <p className="body-medium text-[var(--color-success)]">
                  {creditBatch.totalCo2eStoredTons.toFixed(2)} t
                </p>
              </div>
            )}
            {netCo2eRemoval != null && (
              <div>
                <p className="text-[var(--text-xs)] text-[var(--color-success)] font-medium">
                  Net CO2e Removal
                </p>
                <p className="body-medium text-[var(--color-success)]">
                  {netCo2eRemoval.toFixed(2)} t
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Buffer Pool */}
      {creditBatch.bufferPoolPercent != null && (
        <div className="mb-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
          <span className="font-medium">Buffer Pool:</span>{" "}
          {creditBatch.bufferPoolPercent.toFixed(1)}%
        </div>
      )}

      {/* Certifier & Registry */}
      <div className="flex flex-wrap gap-16 mb-16 text-[var(--text-s)] text-[var(--color-text-secondary)]">
        {creditBatch.certifier && (
          <span>
            <span className="font-medium">Certifier:</span>{" "}
            {creditBatch.certifier}
          </span>
        )}
        {creditBatch.registry && (
          <span>
            <span className="font-medium">Registry:</span>{" "}
            {creditBatch.registry}
          </span>
        )}
      </div>

      {/* View Related Links */}
      <ViewRelatedGroup className="mb-16">
        {creditBatch.facilityId && (
          <FacilityLink
            id={creditBatch.facilityId}
            label={creditBatch.facility?.name || "Facility"}
          />
        )}
        {(creditBatch.applicationCount ?? 0) > 0 && (
          <ApplicationLink
            label="Applications"
            count={creditBatch.applicationCount}
          />
        )}
      </ViewRelatedGroup>

      {/* Actions */}
      {(onEdit || onDelete) && (
        <div className="flex items-center gap-16 pt-24 border-t border-[var(--color-border-secondary)]">
          {onEdit && (
            <button
              onClick={() => onEdit(creditBatch)}
              className="flex items-center gap-8 px-12 py-6 text-[var(--text-s)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
            >
              <PencilSimple size={16} />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(creditBatch.id)}
              className="flex items-center gap-8 px-12 py-6 text-[var(--text-s)] text-[var(--color-error)] hover:text-[var(--color-error-dark)] transition-colors"
            >
              <Trash size={16} />
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
