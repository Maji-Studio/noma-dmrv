import type { LocationDistanceFillResult } from "@/data-access/location-distance-fill";

export function locationDistanceFillWarnings(kind: "supplier" | "customer", { filled, skipped }: LocationDistanceFillResult): string[] {
  const singular = kind === "supplier" ? "intake" : "delivery";
  const plural = kind === "supplier" ? "intakes" : "deliveries";
  const warnings: string[] = [];
  if (filled) warnings.push(`${kind === "supplier" ? "Filled the missing distance" : "Recorded the distance"} on ${filled} ${filled === 1 ? singular : plural}.`);
  if (skipped.submitted) warnings.push(`${skipped.submitted} ${skipped.submitted === 1 ? singular : plural} ${skipped.submitted === 1 ? "belongs" : "belong"} to a submitted Removal and ${skipped.submitted === 1 ? "was" : "were"} left unchanged.`);
  if (skipped.concurrent) warnings.push(`${skipped.concurrent} ${skipped.concurrent === 1 ? singular : plural} changed while the location was being saved and ${skipped.concurrent === 1 ? "was" : "were"} left unchanged.`);
  if (skipped.repointed) warnings.push(`${skipped.repointed} ${skipped.repointed === 1 ? singular : plural} moved to another ${kind === "supplier" ? "supplier or facility" : "location or facility"} and ${skipped.repointed === 1 ? "was" : "were"} left unchanged.`);
  return warnings;
}

export function customerLocationDefaultMovedWarning(name: string): string {
  return `${name} is now the default location.`;
}
