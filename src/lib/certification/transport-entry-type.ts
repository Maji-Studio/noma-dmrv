import { SafeError } from "@/lib/errors";

export function assertTransportEntryType(entityType: string): void {
  if (entityType === "sample") {
    throw new SafeError("Record sample shipping as an emissions entry on a credit batch.");
  }
}
