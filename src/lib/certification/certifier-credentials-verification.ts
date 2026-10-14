/**
 * Operator-facing outcomes of the connection check that runs after certifier
 * keys are saved. A plain module (no "use server", no imports) so the server
 * action and the E2E specs share one copy of the text.
 */
/** Opens every success message. */
const CONNECTED = "Connected to Isometric.";

export const CERTIFIER_VERIFICATION_MESSAGES = {
  connected: CONNECTED,
  checkUnavailable:
    "Keys saved, but the connection check could not run. Reload the page to try again.",
  notConfigured:
    "Keys saved, but this deployment is not configured to reach Isometric. Ask a Platform Admin to check Diagnostics.",
  network:
    "Keys saved, but Isometric could not be reached. Check the connection, then try again.",
  rejected:
    "Keys saved, but Isometric rejected them. Check the access token and client secret, then save again.",
  noProjects: `${CONNECTED} This account has no projects yet, so there is nothing to link the facility to.`,
} as const;

/** The parts of an `IsometricApiError` the failure message depends on. */
export interface CertifierVerificationFailure {
  code?: "not_configured" | "network" | "http";
  status?: number;
}

export function certifierVerificationSuccessMessage(projectCount: number): string {
  if (projectCount === 0) return CERTIFIER_VERIFICATION_MESSAGES.noProjects;
  return `${CONNECTED} ${projectCount} project${
    projectCount === 1 ? "" : "s"
  } available to link.`;
}

/** `failure` is null when the error did not come from the Isometric client. */
export function certifierVerificationFailureMessage(
  failure: CertifierVerificationFailure | null,
): string {
  if (!failure) return CERTIFIER_VERIFICATION_MESSAGES.checkUnavailable;
  if (failure.code === "not_configured") {
    return CERTIFIER_VERIFICATION_MESSAGES.notConfigured;
  }
  if (failure.code === "network") return CERTIFIER_VERIFICATION_MESSAGES.network;
  if (failure.status === 401 || failure.status === 403) {
    return CERTIFIER_VERIFICATION_MESSAGES.rejected;
  }
  return `Keys saved, but Isometric returned an error (${
    failure.status ?? "no status code"
  }). Check the keys, then save again.`;
}
