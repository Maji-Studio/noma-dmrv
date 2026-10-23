/**
 * Whether the viewer may change Removal templates (an Admin). The routed page
 * reads the role on the server and provides it, so rows deep in the Emissions
 * list can offer the templates action only to those who can use it. Without a
 * provider nobody is offered it.
 */
"use client";

import { createContext, useContext, type ReactNode } from "react";

const TemplatePermissionContext = createContext(false);

export function TemplatePermissionProvider({ canManage, children }: { canManage: boolean; children: ReactNode }) {
  return <TemplatePermissionContext.Provider value={canManage}>{children}</TemplatePermissionContext.Provider>;
}

export function useCanManageTemplates(): boolean {
  return useContext(TemplatePermissionContext);
}
