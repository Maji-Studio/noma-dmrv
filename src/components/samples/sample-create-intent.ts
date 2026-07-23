import { CREATE_INTENT_PARAM } from "@/lib/create-intent";

export const SAMPLE_CREATE_CREDIT_BATCH_PARAM = "createCreditBatch";

export function sampleCreateHref(
  facilityId: string,
  creditBatchId: string,
): string {
  const params = new URLSearchParams({
    facility: facilityId,
    [CREATE_INTENT_PARAM]: "true",
    [SAMPLE_CREATE_CREDIT_BATCH_PARAM]: creditBatchId,
  });
  return `/samples?${params.toString()}`;
}

export function resolveSampleCreateCreditBatchId(
  requestedId: string | null | undefined,
  activeFacilityBatches: ReadonlyArray<{ id: string }> | undefined,
): string | undefined {
  if (!requestedId || !activeFacilityBatches) return undefined;
  return activeFacilityBatches.some((batch) => batch.id === requestedId)
    ? requestedId
    : undefined;
}
