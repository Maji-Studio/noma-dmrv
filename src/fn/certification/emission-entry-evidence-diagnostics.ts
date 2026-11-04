import { EmissionEntryEvidenceError } from "@/lib/certification/emission-entry-evidence-error";
import { logger } from "@/lib/log";

/** Keep identifier-only domain diagnostics at the server orchestration boundary. */
export function withEmissionEntryEvidenceDiagnostics<T>(removalId: string | undefined, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof EmissionEntryEvidenceError) {
      logger.warn({ removalId, ...error.ids }, "Emissions entry evidence validation failed");
    }
    throw error;
  }
}
