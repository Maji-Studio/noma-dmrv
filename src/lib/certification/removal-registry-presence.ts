import { isMissingIsometricResource } from "@/lib/isometric/error-utils";

export type RemovalRegistryPresence = "present" | "missing" | "unknown";
export { isRegistryMissingSubmission, REGISTRY_MISSING_CONFIRMED_AT, REGISTRY_MISSING_EXTERNAL_ID, REMOVAL_RESEND_OPERATION } from "./registry-missing-submission";

/** Only an exact resource read's definitive 404 authorizes retirement. */
export async function readRemovalRegistryPresence(read: () => Promise<unknown>, externalId: string): Promise<RemovalRegistryPresence> {
  try {
    await read();
    return "present";
  } catch (error) {
    return isMissingIsometricResource(error, null, externalId) ? "missing" : "unknown";
  }
}
