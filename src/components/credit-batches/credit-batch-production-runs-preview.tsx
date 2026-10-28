import { recordHref } from "@/lib/record-links";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowsClockwiseIcon,
  FactoryIcon,
} from "@phosphor-icons/react/dist/ssr";
import { SectionLabel } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { formatDate } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { COMPLETED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { CENTRED_HIT_AREA, INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";

export interface RetainedProductionRunPreview {
  id: string;
  run?: CreditBatchProductionRunOption;
}

interface CreditBatchProductionRunsPreviewProps {
  matchingRuns: CreditBatchProductionRunOption[];
  retainedRuns: RetainedProductionRunPreview[];
  currentCreditBatchId?: string;
  isReady: boolean;
  isLoading: boolean;
  isError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  /** Derived totals for the selected cohort, shown above the run rows so the cohort reads as one block. */
  summary?: ReactNode;
  /** Replaces the default hint, for a batch that does not attach runs by itself. */
  hint?: string;
  /** Facility of the batch: with it, run codes link to the run in a new tab. */
  facilityId?: string;
  /** Runs added in this edit and not yet saved; only these can be taken back. */
  removableRunIds?: ReadonlySet<string>;
  onRemoveRun?: (runId: string) => void;
  /** Add-run control shown under the rows. */
  footer?: ReactNode;
  /** Disables Undo while the form saves. */
  disabled?: boolean;
}

export function ProductionRunCaption({
  run,
  facilityId,
}: {
  run: CreditBatchProductionRunOption;
  facilityId?: string;
}) {
  const bin = run.biocharStorageName;
  if (!facilityId) {
    return bin ? <span className="body-caption text-[var(--color-text-tertiary)]">{bin}</span> : null;
  }
  return (
    <span className="body-caption text-[var(--color-text-tertiary)]">
      <Link
        href={recordHref("productionRun", run.id, { facilityId })}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(INLINE_HIT_AREA, RECORD_CODE_LINK)}
      >
        {run.code}
      </Link>
      {bin ? ` · ${bin}` : ""}
    </span>
  );
}

function ProductionRunPreviewRow({
  run,
  currentCreditBatchId,
  facilityId,
  onRemove,
  disabled,
}: {
  run: CreditBatchProductionRunOption;
  currentCreditBatchId?: string;
  facilityId?: string;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const assignedElsewhere =
    !!run.assignedCreditBatchId &&
    run.assignedCreditBatchId !== currentCreditBatchId;
  const isPreview = run.status !== COMPLETED_PRODUCTION_RUN_STATUS;

  return (
    <div
      data-testid="credit-batch-production-run-preview"
      data-production-run-id={run.id}
      className={`flex min-w-0 items-center justify-between gap-12 border border-[var(--color-border-tertiary)] px-12 py-10 ${
        assignedElsewhere
          ? "bg-[var(--color-background-medium)]"
          : "bg-[var(--color-background-white)]"
      }`}
    >
      <span className="flex min-w-0 flex-col gap-2">
        <span
          className={`body-small font-medium ${
            assignedElsewhere
              ? "text-[var(--color-text-secondary)]"
              : "text-[var(--color-text-primary)]"
          }`}
        >
          {formatDate(run.date)}
        </span>
        <ProductionRunCaption run={run} facilityId={facilityId} />
        {assignedElsewhere && (
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Assigned to another credit batch
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-10">
        {isPreview && <StatusBadge status={run.status} size="small" />}
        <span className="text-right">
          <span className="block body-small tabular-nums text-[var(--color-text-secondary)]">
            {formatWetDryMass({
              wetKg: run.biocharOutputKg,
              dryKg: run.biocharDryMassKg,
            })}
          </span>
        </span>
        {onRemove && (
          <Button
            type="button"
            variant="noOutline"
            size="small"
            className={CENTRED_HIT_AREA}
            disabled={disabled}
            aria-label={`Undo adding ${run.code}`}
            onClick={onRemove}
          >
            Undo
          </Button>
        )}
      </span>
    </div>
  );
}

function UnavailableProductionRunPreviewRow({ id }: { id: string }) {
  return (
    <div
      data-testid="credit-batch-production-run-fallback"
      data-production-run-id={id}
      className="flex min-w-0 items-center justify-between gap-12 border border-[var(--color-border-tertiary)] bg-[var(--color-background-medium)] px-12 py-10"
    >
      <span className="flex min-w-0 flex-col gap-2">
        <span className="body-small font-medium text-[var(--color-text-secondary)]">
          Saved production run
        </span>
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Date and biochar bin unavailable
        </span>
      </span>
      <span className="body-caption text-right text-[var(--color-text-tertiary)]">
        Details unavailable
      </span>
    </div>
  );
}

export function CreditBatchProductionRunsPreview({
  matchingRuns,
  retainedRuns,
  currentCreditBatchId,
  isReady,
  isLoading,
  isError,
  isRetrying,
  onRetry,
  summary,
  hint = "Completed runs matching this feedstock and production window are attached automatically. Non-complete runs are shown as previews.",
  facilityId,
  removableRunIds,
  onRemoveRun,
  footer,
  disabled,
}: CreditBatchProductionRunsPreviewProps) {
  const retainedKnownRuns = retainedRuns.flatMap(({ run }) => (run ? [run] : []));
  const unavailableRunIds = retainedRuns.flatMap(({ id, run }) =>
    run ? [] : [id],
  );
  const visibleRuns = [...matchingRuns, ...retainedKnownRuns];
  const completedCount = visibleRuns.filter(
    (run) => run.status === COMPLETED_PRODUCTION_RUN_STATUS,
  ).length;
  const previewCount = visibleRuns.length - completedCount;
  const hasVisibleRows = visibleRuns.length > 0 || unavailableRunIds.length > 0;

  return (
    <section
      data-testid="credit-batch-production-run-cohort"
      className="space-y-12"
    >
      <SectionLabel hint={hint}>
        Production runs
      </SectionLabel>

      {!isReady ? (
        <Notice tone="info">
          Select a feedstock type and set the production window to load runs.
        </Notice>
      ) : isError ? (
        <Notice
          tone="error"
          action={
            <Button
              type="button"
              variant="noOutline"
              size="small"
              busy={isRetrying}
              onClick={onRetry}
            >
              <ArrowsClockwiseIcon size={14} aria-hidden />
              Retry
            </Button>
          }
        >
          Couldn&apos;t load production runs for this window. Try again.
        </Notice>
      ) : isLoading ? (
        <span
          className="body-small text-[var(--color-text-tertiary)]"
          aria-busy
        >
          Loading production runs…
        </span>
      ) : !hasVisibleRows ? (
        <EmptyState
          icon={<FactoryIcon size={32} weight="bold" aria-hidden />}
          title="No matching production runs"
          description="Matching completed runs attach automatically."
          padding="sm"
        />
      ) : (
        <div className="space-y-8">
          {matchingRuns.length === 0 && retainedRuns.length > 0 && !footer && (
            <p className="body-caption text-[var(--color-text-tertiary)]">
              No additional runs of this feedstock type fall within the
              production window.
            </p>
          )}
          <p className="body-caption text-[var(--color-text-tertiary)]">
            {[
              `${completedCount} completed`,
              `${previewCount} ${previewCount === 1 ? "preview" : "previews"}`,
              ...(unavailableRunIds.length > 0
                ? [`${unavailableRunIds.length} retained`]
                : []),
            ].join(" · ")}
          </p>
          {summary}
          <div className="grid grid-cols-1 gap-8">
            {visibleRuns.map((run) => (
              <ProductionRunPreviewRow
                key={run.id}
                run={run}
                currentCreditBatchId={currentCreditBatchId}
                facilityId={facilityId}
                disabled={disabled}
                onRemove={
                  onRemoveRun && removableRunIds?.has(run.id)
                    ? () => onRemoveRun(run.id)
                    : undefined
                }
              />
            ))}
            {unavailableRunIds.map((id) => (
              <UnavailableProductionRunPreviewRow key={id} id={id} />
            ))}
          </div>
        </div>
      )}
      {isReady && !isError && !isLoading && footer}
    </section>
  );
}
