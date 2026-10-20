/**
 * Settings, General: the organization itself, then the operating defaults
 * that seed new facilities and records (the former Defaults pane, Q12).
 *
 * The name is read-only text for now; renaming the organization arrives with
 * Profile in wave 2. Every member can open the pane (Q15); only Owners and
 * Admins get the controls, which the defaults form decides from the server.
 */
"use client";

import { DetailField, DetailRow, DetailSection } from "@/components/ui/detail-panel";
import type { SettingsViewer } from "@/lib/settings/panes";
import { OrganizationDefaultsForm } from "./organization-defaults-form";

export function GeneralSettingsPane({ viewer }: { viewer: SettingsViewer }) {
  return (
    <div className="flex flex-col gap-32">
      <DetailSection title="Organization" divider={false} className="content-measure-preview">
        <DetailRow>
          <DetailField label="Name" value={viewer.organizationName} />
          <DetailField label="Slug" value={viewer.organizationSlug} emptySituation="notSet" />
        </DetailRow>
      </DetailSection>
      <OrganizationDefaultsForm />
    </div>
  );
}
