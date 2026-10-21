/**
 * Where the viewer is and as whom: the active organization and the viewer's
 * standing in it. Resolved on the server in the app layout (where the org
 * context already lives) and handed down, so the sidebar chip, the mobile top
 * bar and the Platform Admin bar agree on first paint.
 *
 * The session is shared by every tab. When another tab switches organization,
 * this page's server value is stale: the provider claims nothing (null) and
 * reloads once so the layout resolves the new organization.
 */
"use client";

import { createContext, useContext, useEffect, type ReactNode } from "react";
import { authClient } from "@/lib/auth/client";
import { isOrgMismatch, type ViewerOrg } from "./viewer-org-rules";

const ViewerOrgContext = createContext<ViewerOrg | null>(null);

const RELOAD_GUARD_KEY = "noma:viewer-org-reload";
const RELOAD_GUARD_MS = 10_000;

/** Reload at most once per guard window, so a stale session cache cannot loop. */
function reloadOnce(): void {
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    if (Date.now() - last < RELOAD_GUARD_MS) return;
    window.sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage blocked: reload anyway, once per mismatch render.
  }
  window.location.reload();
}

export function ViewerOrgProvider({
  value,
  children,
}: {
  value: ViewerOrg | null;
  children: ReactNode;
}) {
  const { data: sessionData } = authClient.useSession();
  const sessionOrganizationId =
    (sessionData?.session as { activeOrganizationId?: string | null } | undefined)
      ?.activeOrganizationId ?? null;
  const mismatch = isOrgMismatch(value?.organizationId ?? null, sessionOrganizationId);

  // Reloading is the external-system sync an effect exists for.
  useEffect(() => {
    if (mismatch) reloadOnce();
  }, [mismatch]);

  return (
    <ViewerOrgContext.Provider value={mismatch ? null : value}>{children}</ViewerOrgContext.Provider>
  );
}

export function useViewerOrg(): ViewerOrg | null {
  return useContext(ViewerOrgContext);
}
