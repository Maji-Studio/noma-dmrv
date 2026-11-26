"use client";

/**
 * A Failed run's emissions caption on its read sheet (#1714). A counted run
 * lists its credit batch under Used by ("CB-26-001, emissions only"), so this
 * caption speaks only when there is nothing to list: no matching batch, mixed
 * or empty feedstock, or a failed read. Reads the saved attachment, so it
 * shows nothing for a run that is not Failed and nothing while loading.
 */
import { RecordUsedBy } from "@/components/record-locks/record-used-by";
import { EmissionsLine } from "@/components/record-locks/record-used-by-next-step";
import { TextAction } from "@/components/ui/text-action";
import { useProductionRunCreditBatchPreview } from "@/hooks/use-production-run-credit-batch-preview";
import { TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import type { RecordLockView } from "@/lib/record-lock-view";
import { FAILED_PRODUCTION_RUN_STATUS } from "@/lib/production-runs/lifecycle";
import { describeFailedRunEmissions } from "@/lib/production-runs/failed-run-emission-copy";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";

export const FAILED_RUN_SHEET_ERROR_MESSAGE = "Couldn't check where its emissions count.";

export function FailedRunEmissionLineView({ guidance }: { guidance: FailedRunEmissionGuidance }) {
  // The batch of a counted run is a Used by entry, not a caption.
  if (guidance.state === "attached") return null;
  const copy = describeFailedRunEmissions(guidance);
  // Mixed and empty feedstock point at this same sheet: Edit is the way to change the draws.
  const navigates = guidance.state === "no-match";
  return <EmissionsLine lead={copy.lead} tone={copy.tone} action={navigates ? copy.action : null} />;
}

type SheetRun = { id: string; facilityId: string; status: string } | null | undefined;

export function FailedRunSheetEmissionsView({ guidance, isError, isFetching, onRetry }: {
  guidance: FailedRunEmissionGuidance | undefined;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
}) {
  if (isError) {
    return (
      <div className="flex flex-col" data-testid="failed-run-sheet-error">
        <EmissionsLine lead={FAILED_RUN_SHEET_ERROR_MESSAGE} tone="warning" />
        <TextAction busy={isFetching} onClick={onRetry}>{TRY_AGAIN_LABEL}</TextAction>
      </div>
    );
  }
  return guidance ? <FailedRunEmissionLineView guidance={guidance} /> : null;
}

/**
 * A production run's Used by. A Failed run reads the chain although the lock
 * names no user, since its emissions batch is no lock reference, and closes
 * with the attachment's caption; a failed attachment read keeps "None" away.
 */
export function FailedRunUsedBy({ lock, run }: { lock: RecordLockView | undefined; run: SheetRun }) {
  const failed = run?.status === FAILED_PRODUCTION_RUN_STATUS;
  const query = useProductionRunCreditBatchPreview(failed && run ? {
    savedOnly: true,
    productionRunId: run.id,
    facilityId: run.facilityId,
    status: FAILED_PRODUCTION_RUN_STATUS,
    startTime: null,
    endTime: null,
    feedstockStorageLocationIds: [],
  } : null);
  const closing = failed && (
    <FailedRunSheetEmissionsView guidance={query.data?.savedEmissionAttachment} isError={query.isError} isFetching={query.isFetching} onRetry={() => void query.refetch()} />
  );
  return <RecordUsedBy lock={lock} record={{ kind: "productionRun", id: run?.id }} closing={closing} readsChain={failed} holdsNone={query.isError} />;
}
