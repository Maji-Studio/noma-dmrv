"use client";

import {
  CertificateIcon,
  CheckCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { formatSafeDate } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import {
  formatCreditBatchStatus,
  type CreditBatchStatus,
} from "@/schemas/credit-batches";
import { EmptyState, StatusBadge } from "@/components/ui";

const CREDIT_BATCH_CARD_WIDTH_CLASS = "w-[272px] sm:w-[288px]";

interface CreditBatchCardSelectorProps {
  batches: CreditBatchWithRelations[];
  selectedBatchId: string | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onSelect: (batchId: string) => void;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function CreditBatchCardSelector({
  batches,
  selectedBatchId,
  isLoading,
  isError,
  error,
  onSelect,
}: CreditBatchCardSelectorProps) {
  return (
    <section
      aria-labelledby="chain-batch-selector-label"
      data-testid="chain-batch-selector"
      className="min-w-0"
    >
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-8">
        <p
          id="chain-batch-selector-label"
          className="body-caption uppercase tracking-[0.12em] text-[var(--color-text-tertiary)]"
        >
          Credit batch
        </p>
        <p className="body-caption text-[var(--color-text-secondary)]">
          Choose a reporting batch. Your last choice is remembered per facility.
        </p>
      </div>

      {isLoading ? (
        <div
          role="status"
          className="flex min-h-48 items-center gap-8 border border-dashed border-[var(--color-border-secondary)] bg-[var(--paper)] px-12 body-small text-[var(--color-text-secondary)]"
        >
          <CertificateIcon aria-hidden size={20} className="animate-pulse" />
          Loading credit batches…
        </div>
      ) : isError ? (
        <EmptyState
          padding="sm"
          icon={<WarningIcon size={32} weight="bold" />}
          title="Credit batches could not be loaded"
          description={error?.message ?? "Refresh the page to try again."}
        />
      ) : batches.length === 0 ? (
        <EmptyState
          padding="sm"
          icon={<CertificateIcon size={32} weight="bold" />}
          title="No credit batches for this facility"
          description="Create a credit batch before reviewing its traceability."
        />
      ) : (
        <div className="overflow-x-auto pb-4">
          <div
            role="radiogroup"
            aria-label="Credit batches for this facility"
            className="flex min-w-max gap-8"
          >
            {batches.map((batch) => {
              const isSelected = batch.id === selectedBatchId;
              return (
                <label
                  key={batch.id}
                  data-testid={`chain-batch-card-${batch.id}`}
                  className={cn(
                    CREDIT_BATCH_CARD_WIDTH_CLASS,
                    "relative flex min-h-96 shrink-0 cursor-pointer flex-col justify-between gap-8 border-[1.5px] bg-[var(--paper)] p-12 transition-colors duration-300",
                    "hover:border-[var(--color-interaction)] has-[:focus-visible]:outline-none has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-[var(--color-interaction)]",
                    isSelected
                      ? "border-[var(--color-interaction)] bg-[var(--color-background-interaction-light)]"
                      : "border-[var(--color-border-secondary)]",
                  )}
                >
                  <input
                    type="radio"
                    name="chain-credit-batch"
                    value={batch.id}
                    checked={isSelected}
                    onChange={() => onSelect(batch.id)}
                    data-testid={`chain-batch-radio-${batch.id}`}
                    className="sr-only"
                  />

                  <div className="flex min-w-0 items-start justify-between gap-8">
                    <span className="min-w-0 truncate font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-primary)]">
                      {batch.code}
                    </span>
                    <StatusBadge
                      size="small"
                      status={batch.status as CreditBatchStatus}
                      label={formatCreditBatchStatus(
                        batch.status as CreditBatchStatus,
                      )}
                    />
                  </div>

                  <p className="body-caption text-[var(--color-text-secondary)]">
                    {formatSafeDate(batch.startDate)} —{" "}
                    {formatSafeDate(batch.endDate)}
                  </p>

                  <div className="flex items-center justify-between gap-8 body-caption text-[var(--color-text-tertiary)]">
                    <span>
                      {countLabel(batch.productionRunCount, "run")} ·{" "}
                      {countLabel(batch.applicationCount, "application")}
                    </span>
                    {isSelected ? (
                      <span className="inline-flex shrink-0 items-center gap-4 font-medium text-[var(--color-interaction)]">
                        <CheckCircleIcon aria-hidden size={16} weight="fill" />
                        Selected
                      </span>
                    ) : null}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
