/**
 * A warning that has to survive a full page load.
 *
 * Some outcomes are decided in the same breath as a reload: switching
 * organization, accepting an invitation, and creating an account from an
 * invitation all finish with `window.location.assign`, which throws away any
 * toast raised beside it. Those flows stash the warning here instead, and the
 * toast provider on the next load shows it once (issue #769).
 *
 * Only warnings travel this way. A failure keeps the operator on the page, so
 * it never needs to cross a navigation.
 */
const PENDING_WARNING_KEY = "noma:pending-warning";

/** Hold a warning for the page the operator is about to land on. */
export function stashPendingWarning(message: string | undefined): void {
  if (!message || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_WARNING_KEY, message);
  } catch {
    // Storage can be blocked. The navigation matters more than the notice.
  }
}

/** Read and clear the stashed warning. Answers null when there is none. */
export function takePendingWarning(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const message = window.sessionStorage.getItem(PENDING_WARNING_KEY);
    window.sessionStorage.removeItem(PENDING_WARNING_KEY);
    return message || null;
  } catch {
    return null;
  }
}
