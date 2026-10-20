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

export type OrgSwitchNotice = { organizationName: string | null };

/** Mark that the next load follows an organization switch. */
export function stashOrgSwitchNotice(organizationName?: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(ORG_SWITCH_KEY, organizationName?.trim() ?? "");
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
    return stored === null ? null : { organizationName: stored || null };
  } catch {
    return null;
  }
}

export function orgSwitchMessage(organizationName: string): string {
  return `Now working in ${organizationName}`;
}
