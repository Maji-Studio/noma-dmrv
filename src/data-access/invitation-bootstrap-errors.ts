import { DomainError } from "@/lib/domain-errors";

/** Distinguish concurrent account creation from other bootstrap refusals. */
export class InvitationAccountExistsError extends DomainError {
  constructor() {
    super("account_exists", "An account already exists for this invitation. Sign in instead.");
    this.name = "InvitationAccountExistsError";
  }
}
