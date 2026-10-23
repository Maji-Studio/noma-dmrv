import { SafeError } from "@/lib/errors";

/** Preserve existing operator copy without exposing arbitrary compile errors. */
export class RemovalComparisonBlockedError extends SafeError {
  constructor(readonly messages: string[]) {
    super(messages[0]);
  }
}

