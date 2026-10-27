import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { formatDate } from "@/lib/format-utils";
import { formatWetDryMass } from "@/lib/mass-moisture";
import { CENTRED_HIT_AREA } from "@/components/ui/touch-target";
import { ProductionRunCaption } from "./credit-batch-production-runs-preview";

interface CreditBatchAddRunsProps {
  /** Completed, unassigned runs of the batch's feedstock type inside its window. */
  runs: CreditBatchProductionRunOption[];
  facilityId?: string;
  onAdd: (runId: string) => void;
  disabled?: boolean;
}

/**
 * A batch held by a draft or returned Removal keeps its runs, dates, facility
 * and feedstock type. A run that was missed can still be added.
 */
export function CreditBatchAddRuns({ runs, facilityId, onAdd, disabled = false }: CreditBatchAddRunsProps) {
  if (runs.length === 0) {
    return (
      <p data-testid="credit-batch-add-runs-empty" className="body-caption text-[var(--color-text-tertiary)]">
        No other completed runs of this feedstock type fall within the production window.
      </p>
    );
  }
  return (
    <div data-testid="credit-batch-add-runs" className="space-y-8">
      <p className="body-caption text-[var(--color-text-tertiary)]">Not in this batch yet</p>
      <div className="grid grid-cols-1 gap-8">
        {runs.map((run) => (
          <div
            key={run.id}
            data-testid="credit-batch-add-run"
            data-production-run-id={run.id}
            className="flex min-w-0 items-center justify-between gap-12 border border-dashed border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] px-12 py-10"
          >
            <span className="flex min-w-0 flex-col gap-2">
              <span className="body-small font-medium text-[var(--color-text-primary)]">{formatDate(run.date)}</span>
              <ProductionRunCaption run={run} facilityId={facilityId} />
              <span className="body-caption tabular-nums text-[var(--color-text-secondary)]">
                {formatWetDryMass({ wetKg: run.biocharOutputKg, dryKg: run.biocharDryMassKg })}
              </span>
            </span>
            <Button
              type="button"
              variant="noOutline"
              size="small"
              className={CENTRED_HIT_AREA}
              disabled={disabled}
              aria-label={`Add run ${run.code}`}
              onClick={() => onAdd(run.id)}
            >
              <PlusIcon size={14} aria-hidden />
              Add run
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
