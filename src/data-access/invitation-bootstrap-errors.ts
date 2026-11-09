import { SafeError } from "@/lib/errors";

/** Distinguish concurrent account creation from other bootstrap refusals. */
export class InvitationAccountExistsError extends SafeError {
  constructor() {
    super("An account already exists for this invitation. Sign in instead.");
    this.name = "InvitationAccountExistsError";
  }
}
