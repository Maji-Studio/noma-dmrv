import { env } from "@/config/env";
import { SafeError } from "@/lib/errors";

export function emissionsEntriesEnabled(): boolean { return env.EMISSIONS_ENTRIES_ENABLED; }
export function requireEmissionsEntriesEnabled(): void {
  if (!emissionsEntriesEnabled()) throw new SafeError("Emissions entries are not available yet.");
}
export function assertTransportEntryType(entityType: string): void {
  if (entityType === "sample" && emissionsEntriesEnabled()) {
    throw new SafeError("Record sample shipping as an emissions entry on a credit batch.");
  }
}
