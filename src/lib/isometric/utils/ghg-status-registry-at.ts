import type { GhgStatement } from "../ghg-statements";

/** Only use a registry timestamp that describes the observed status. */
export function ghgStatusRegistryAt(
  remote: Pick<GhgStatement, "status" | "submitted_at" | "credits_issued_at">,
): Date | null {
  const timestamp = remote.status === "AWAITING_VERIFICATION"
    ? remote.submitted_at
    : remote.status === "CREDITS_ISSUED" ? remote.credits_issued_at : null;
  return timestamp ? new Date(timestamp) : null;
}
