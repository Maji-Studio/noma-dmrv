/**
 * Shows "Now working in <org>" once, after the reload that follows an
 * organization switch. The marker travels in session storage (see
 * `org-switch-notice.ts`); it is read after mount so the first paint matches
 * the server.
 */
"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { orgSwitchMessage, takeOrgSwitchNotice } from "@/lib/org-switch-notice";
import { useViewerOrg } from "./viewer-org";

export function OrgSwitchToast() {
  const { success } = useToast();
  const viewer = useViewerOrg();
  const landedName = viewer?.organizationName ?? null;
  useEffect(() => {
    const notice = takeOrgSwitchNotice();
    const name = notice?.organizationName ?? (notice ? landedName : null);
    if (name) success(orgSwitchMessage(name));
  }, [success, landedName]);
  return null;
}
