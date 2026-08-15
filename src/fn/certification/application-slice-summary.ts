import type { BatchLineageApplicationFact } from "@/data-access/credit-batch-accounting";

export interface ApplicationSliceSummary {
  applicationId: string;
  allocatedWetMassKg: number;
  allocatedDryMassKg: number;
}

export function summarizeApplicationSlices(
  applications: BatchLineageApplicationFact[],
): ApplicationSliceSummary[] {
  const slices = new Map<string, ApplicationSliceSummary>();
  for (const application of applications) {
    const slice = slices.get(application.id) ?? {
      applicationId: application.id,
      allocatedWetMassKg: 0,
      allocatedDryMassKg: 0,
    };
    slice.allocatedWetMassKg += application.biocharAppliedTons * 1_000;
    slice.allocatedDryMassKg +=
      (application.biocharAppliedDryTons ?? 0) * 1_000;
    slices.set(application.id, slice);
  }
  return [...slices.values()].sort((a, b) =>
    a.applicationId.localeCompare(b.applicationId),
  );
}
