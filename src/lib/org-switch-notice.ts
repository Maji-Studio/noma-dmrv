/**
 * The "Now working in <org>" confirmation that has to survive a full page load.
 *
 * Every organization switch (sidebar switcher, Platform "Open", accepting an
 * invitation) ends with `window.location.assign`, which throws away a toast
 * raised beside it. The switch stashes a marker in session storage and the
 * app shell shows the toast once after the next load, as `pending-warning.ts`
 * does for warnings. The name is optional: a flow that does not know it (an
 * accepted invitation) lets the shell fill in the organization it landed in.
 */
const ORG_SWITCH_KEY = "noma:org-switched";

/** The organization a switch aimed at; both fields are unknown for an accepted invitation. */
export type OrgSwitchTarget = { organizationId?: string; organizationName?: string };
export type OrgSwitchNotice = { organizationId: string | null; organizationName: string | null };

/** Mark that the next load follows an organization switch. */
export function stashOrgSwitchNotice(target: OrgSwitchTarget = {}): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      ORG_SWITCH_KEY,
      JSON.stringify({
        organizationId: target.organizationId ?? null,
        organizationName: target.organizationName?.trim() || null,
      }),
    );
  } catch {
    // Storage can be blocked. The navigation matters more than the notice.
  }
}

/** Read and clear the marker. Answers null when no switch just happened. */
export function takeOrgSwitchNotice(): OrgSwitchNotice | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(ORG_SWITCH_KEY);
    window.sessionStorage.removeItem(ORG_SWITCH_KEY);
    if (stored === null) return null;
    const parsed = JSON.parse(stored) as Partial<OrgSwitchNotice>;
    return {
      organizationId: parsed.organizationId ?? null,
      organizationName: parsed.organizationName ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The name to announce. The stashed name counts only when its organization is
 * the one that actually loaded (two tabs can switch to different ones);
 * otherwise the landed organization is named.
 */
export function orgNameToAnnounce(
  notice: OrgSwitchNotice,
  landed: { organizationId: string; organizationName: string } | null,
): string | null {
  if (!landed) return notice.organizationName;
  const stashedMatches = notice.organizationId === landed.organizationId;
  return stashedMatches && notice.organizationName ? notice.organizationName : landed.organizationName;
}

export function orgSwitchMessage(organizationName: string): string {
  return `Now working in ${organizationName}.`;
}

/** The failure toast for a switch that could not start; names the organization it aimed at. */
export function orgSwitchFailedMessage(organizationName: string): string {
  return `${organizationName} did not open. Try again.`;
}

/** The discard dialog's body when a switch would leave a pane with unsaved changes. */
export const ORG_SWITCH_DISCARD_DESCRIPTION =
  "This section has changes that are not saved. Switching organization discards them.";
