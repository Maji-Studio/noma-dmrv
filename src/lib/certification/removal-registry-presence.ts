import { logger, sanitizeErrorMessage } from "@/lib/log";
import { isMissingIsometricResource } from "@/lib/isometric/error-utils";

export type RemovalRegistryPresence = "present" | "missing" | "unknown";
export { isRegistryMissingSubmission, REGISTRY_MISSING_CONFIRMED_AT, REGISTRY_MISSING_EXTERNAL_ID, REMOVAL_RESEND_OPERATION } from "./registry-missing-submission";

/** Only an exact resource read's definitive 404 authorizes retirement. */
export async function readRemovalRegistryPresence(read: () => Promise<unknown>, externalId: string): Promise<RemovalRegistryPresence> {
  try {
    await read();
    return "present";
  } catch (error) {
    if (isMissingIsometricResource(error, null, externalId)) return "missing";
    // Server-side only (the client imports its types). Ids and the sanitized message, never bodies or PII.
    logger.error({ externalId, error: sanitizeErrorMessage(error) }, "Registry presence read failed");
    return "unknown";
  }
}
