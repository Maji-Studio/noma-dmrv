import { emissionsEntriesEnabled } from "@/lib/certification/emissions-entry-gate";
import type { SourceFactKey } from "../semantic-binding-catalog";

export const RETIRED_SOURCE_FACT = "sampleTransportMassDistanceTonneKm" satisfies SourceFactKey;

/** Kept independent of catalog initialization so catalog projections can share it. */
export function sourceFactAvailable(source: string): boolean {
  return source !== RETIRED_SOURCE_FACT || !emissionsEntriesEnabled();
}
