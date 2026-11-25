"use client";

/**
 * A Failed run's emissions line on its read sheet (#1714): where its diesel,
 * electricity and feedstock transport count. Reads the saved attachment, so
 * it shows nothing for a run that is not Failed and nothing while loading.
 */
import { EmissionsLine } from "@/components/record-locks/record-used-by-next-step";
import { useProductionRunCreditBatchPreview } from "@/hooks/use-production-run-credit-batch-preview";
import { describeFailedRunEmissions } from "./failed-run-emission-copy";
import type { FailedRunEmissionGuidance } from "@/types/failed-run-emission-guidance";

export function FailedRunEmissionLineView({ guidance }: { guidance: FailedRunEmissionGuidance }) {
  const copy = describeFailedRunEmissions(guidance);
  return <EmissionsLine lead={copy.lead} batch={copy.batch} facilityId={guidance.facilityId} action={copy.action} />;
}

export function FailedRunSheetEmissions({ run }: { run: { id: string; facilityId: string; status: string } | null | undefined }) {
  const failed = run?.status === "failed";
  const query = useProductionRunCreditBatchPreview(failed && run ? {
    savedOnly: true,
    productionRunId: run.id,
    facilityId: run.facilityId,
    status: "failed",
    startTime: null,
    endTime: null,
    feedstockStorageLocationIds: [],
  } : null);
  const guidance = query.data?.savedEmissionAttachment;
  return guidance ? <FailedRunEmissionLineView guidance={guidance} /> : null;
}
