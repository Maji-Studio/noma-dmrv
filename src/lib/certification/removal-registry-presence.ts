import { getMetadataValue } from "./submission-metadata";
import { isMissingIsometricResource } from "@/lib/isometric/error-utils";

export type RemovalRegistryPresence = "present" | "missing" | "unknown";
export const REGISTRY_MISSING_CONFIRMED_AT = "registryMissingConfirmedAt";
export const REGISTRY_MISSING_EXTERNAL_ID = "registryMissingExternalId";
export const REMOVAL_RESEND_OPERATION = "removal:prepare-resend";

/** Only an exact resource read's definitive 404 authorizes retirement. */
export async function readRemovalRegistryPresence(read: () => Promise<unknown>, externalId: string): Promise<RemovalRegistryPresence> {
  try {
    await read();
    return "present";
  } catch (error) {
    return isMissingIsometricResource(error, null, externalId) ? "missing" : "unknown";
  }
}

export function isRegistryMissingSubmission(row: { status: string; externalId: string | null; metadata: unknown } | null | undefined): boolean {
  return !!row && row.status === "superseded" && !!row.externalId &&
    getMetadataValue(row.metadata, REGISTRY_MISSING_EXTERNAL_ID) === row.externalId &&
    typeof getMetadataValue(row.metadata, REGISTRY_MISSING_CONFIRMED_AT) === "string";
}
