import { getMetadataValue } from "./submission-metadata";

export const REGISTRY_MISSING_CONFIRMED_AT = "registryMissingConfirmedAt";
export const REGISTRY_MISSING_EXTERNAL_ID = "registryMissingExternalId";
export const REMOVAL_RESEND_OPERATION = "removal:prepare-resend";

export function isRegistryMissingSubmission(row: { status: string; externalId: string | null; metadata: unknown } | null | undefined): boolean {
  return !!row && row.status === "superseded" && !!row.externalId &&
    getMetadataValue(row.metadata, REGISTRY_MISSING_EXTERNAL_ID) === row.externalId &&
    typeof getMetadataValue(row.metadata, REGISTRY_MISSING_CONFIRMED_AT) === "string";
}
