import type { BatchLineageApplicationFact } from "@/data-access/credit-batch-accounting";
import { tonnesToKg } from "@/lib/calculations/unit-conversions";

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
    slice.allocatedWetMassKg += tonnesToKg(application.biocharAppliedTons);
    slice.allocatedDryMassKg +=
      tonnesToKg(application.biocharAppliedDryTons ?? 0);
    slices.set(application.id, slice);
  }
  return [...slices.values()].sort((a, b) =>
    a.applicationId.localeCompare(b.applicationId),
  );
}
