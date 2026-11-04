/**
 * Settings, General: the organization itself, then the operating defaults
 * that seed new facilities and records (the former Defaults pane, Q12).
 *
 * Admins rename the organization here (wave 2, Q5); the slug is not shown
 * (Q6). Every member can open the pane (Q15); only Admins get the controls,
 * which the server decides for both forms.
 */
"use client";

import { DetailSection } from "@/components/ui/detail-panel";
import type { SettingsViewer } from "@/lib/settings/panes";
import { OrganizationDefaultsForm } from "./organization-defaults-form";
import { OrganizationNameForm } from "./organization-name-form";

export function GeneralSettingsPane({ viewer }: { viewer: SettingsViewer }) {
  return (
    <div className="flex flex-col gap-32">
      <DetailSection title="Organization" divider={false} className="content-measure-preview">
        <OrganizationNameForm name={viewer.organizationName} canManage={viewer.canManage} />
      </DetailSection>
      <OrganizationDefaultsForm />
    </div>
  );
}
