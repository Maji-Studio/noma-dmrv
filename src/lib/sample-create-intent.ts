import { CREATE_INTENT_PARAM } from "@/lib/create-intent";

export const SAMPLE_CREATE_CREDIT_BATCH_PARAM = "createCreditBatch";

export function leaveSampleCreateIntent(
  clearCreateIntent: () => void,
  transition: () => void,
) {
  clearCreateIntent();
  transition();
}

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

/**
 * Open one saved lab Sample in the samples list's view sheet. The list reads the
 * focused id from `?sample=` (see `sample-list.tsx`), so this is the canonical
 * way any other surface links to a sample record.
 */
export function sampleDetailHref(
  facilityId: string,
  sampleId: string,
): string {
  const params = new URLSearchParams({
    facility: facilityId,
    sample: sampleId,
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
