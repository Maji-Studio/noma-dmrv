import { SafeError } from "@/lib/errors";

/** Domain diagnostics cross to fn/ without initializing the server logger. */
export class EmissionEntryEvidenceError extends SafeError {
  constructor(message: string, readonly ids: {
    entryId: string;
    documentId?: string;
    otherEntryId?: string;
    componentId?: string;
    inputKey?: string;
  }) {
    super(message);
    this.name = "EmissionEntryEvidenceError";
  }
}
