/**
 * The "remember my organization" preference written after a successful org
 * switch. The switch itself moves the server session; saving the preference is
 * a separate follow-up that only decides which organization the next sign-in
 * opens. Reporting a failed preference write as a failed switch leaves the
 * client on the old organization while the session has already moved, so every
 * switching action routes the write through here and surfaces a warning
 * instead (issue #769).
 */
import { persistLastActiveOrganization } from "@/data-access/organizations";
import { logger, sanitizeErrorMessage } from "@/lib/log";

/** Shared warning copy for all three switching actions. */
export const ORG_PREFERENCE_NOT_SAVED =
  "You are now in this organization, but it was not saved as your default. You may need to switch again next time.";

/**
 * Save the last-active organization. Returns the operator-facing warning when
 * the write fails, or `undefined` when it succeeded. Never throws, and never
 * logs anything but ids.
 */
export async function saveOrgPreference(
  userId: string,
  organizationId: string,
): Promise<string | undefined> {
  try {
    await persistLastActiveOrganization(userId, organizationId);
    return undefined;
  } catch (error) {
    logger.error(
      {
        userId,
        organizationId,
        errorName: error instanceof Error ? error.name : typeof error,
        errorMessage: sanitizeErrorMessage(error),
      },
      "last active organization preference not saved",
    );
    return ORG_PREFERENCE_NOT_SAVED;
  }
}
