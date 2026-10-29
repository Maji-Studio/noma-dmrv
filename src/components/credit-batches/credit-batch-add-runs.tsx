import { FactoryIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { CENTRED_HIT_AREA } from "@/components/ui/touch-target";
import { ProductionRunPreviewRow } from "./credit-batch-production-runs-preview";

interface CreditBatchAddRunsProps {
  /** Completed, unassigned runs of the batch's feedstock type inside its window. */
  runs: CreditBatchProductionRunOption[];
  facilityId?: string;
  onAdd: (runId: string) => void;
  disabled?: boolean;
}

/**
 * A batch held by a draft or returned Removal keeps its runs, dates, facility
 * and feedstock type. A run that was missed can still be added. A run reads the
 * same here as it does in the list above once added.
 */
export function CreditBatchAddRuns({ runs, facilityId, onAdd, disabled = false }: CreditBatchAddRunsProps) {
  if (runs.length === 0) {
    return (
      <div data-testid="credit-batch-add-runs-empty">
        <EmptyState
          icon={<FactoryIcon size={32} weight="bold" aria-hidden />}
          title="No other completed runs to add"
          padding="sm"
        />
      </div>
    );
  }
  return (
    <div data-testid="credit-batch-add-runs" className="space-y-8">
      <p className="body-caption text-[var(--color-text-tertiary)]">Not in this batch yet</p>
      <div className="grid grid-cols-1 gap-8">
        {runs.map((run) => (
          <div key={run.id} data-testid="credit-batch-add-run" data-production-run-id={run.id}>
            <ProductionRunPreviewRow
              run={run}
              facilityId={facilityId}
              action={
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
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
