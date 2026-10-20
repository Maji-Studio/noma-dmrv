/**
 * Where the viewer is and as whom: the active organization and the viewer's
 * standing in it. Resolved on the server in the app layout (where the org
 * context already lives) and handed down, so the sidebar chip, the mobile top
 * bar and the Platform Admin bar agree on first paint.
 */
"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ViewerOrg } from "./viewer-org-rules";

const ViewerOrgContext = createContext<ViewerOrg | null>(null);

export function ViewerOrgProvider({
  value,
  children,
}: {
  value: ViewerOrg | null;
  children: ReactNode;
}) {
  return <ViewerOrgContext.Provider value={value}>{children}</ViewerOrgContext.Provider>;
}

export function useViewerOrg(): ViewerOrg | null {
  return useContext(ViewerOrgContext);
}
