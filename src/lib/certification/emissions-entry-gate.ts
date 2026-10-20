import { emissionsEntriesEnabledSchema } from "@/config/emissions-entries";
import { SafeError } from "@/lib/errors";

export function emissionsEntriesEnabled(): boolean {
  // Shared certification helpers also run in the browser, where this private
  // flag is absent. Never import the full server environment into their bundle.
  return emissionsEntriesEnabledSchema.parse(process.env.EMISSIONS_ENTRIES_ENABLED);
}
export function requireEmissionsEntriesEnabled(): void {
  if (!emissionsEntriesEnabled()) throw new SafeError("Emissions entries are not available yet.");
}
export function assertTransportEntryType(entityType: string): void {
  if (entityType === "sample" && emissionsEntriesEnabled()) {
    throw new SafeError("Record sample shipping as an emissions entry on a credit batch.");
  }
}
