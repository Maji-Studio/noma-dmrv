import { isMissingIsometricResource } from "@/lib/isometric/error-utils";
import type { RemovalRegistryPresence } from "./removal-registry-presence";

/** Server only: it reaches the Isometric client, so the pure presence module (read by status code) does not hold it. */
/** Only an exact resource read's definitive 404 authorizes retirement. */
export async function readRemovalRegistryPresence(read: () => Promise<unknown>, externalId: string, onUnknown?: (error: unknown) => void): Promise<RemovalRegistryPresence> {
  try {
    await read();
    return "present";
  } catch (error) {
    if (isMissingIsometricResource(error, null, externalId)) return "missing";
    // The caller logs (this module stays free of the server logger).
    onUnknown?.(error);
    return "unknown";
  }
}
