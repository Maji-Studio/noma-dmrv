/**
 * Shows "Now working in <org>" once, after the reload that follows an
 * organization switch. The marker travels in session storage (see
 * `org-switch-notice.ts`); it is read after mount so the first paint matches
 * the server.
 */
"use client";

import { useEffect } from "react";
import { useToast } from "@/components/ui/toast";
import { orgNameToAnnounce, orgSwitchMessage, takeOrgSwitchNotice } from "@/lib/org-switch-notice";
import { useViewerOrg } from "./viewer-org";

export function OrgSwitchToast() {
  const { success } = useToast();
  const viewer = useViewerOrg();
  const landedId = viewer?.organizationId ?? null;
  const landedName = viewer?.organizationName ?? null;
  useEffect(() => {
    const notice = takeOrgSwitchNotice();
    if (!notice) return;
    const landed = landedId && landedName ? { organizationId: landedId, organizationName: landedName } : null;
    const name = orgNameToAnnounce(notice, landed);
    if (name) success(orgSwitchMessage(name));
  }, [success, landedId, landedName]);
  return null;
}
