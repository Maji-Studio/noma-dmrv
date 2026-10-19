"use client";

import { OrganizationRosterDetails, OrganizationRosterList, OrganizationRosterRow } from "@/components/organizations/organization-roster-list";
import { Button } from "@/components/ui";
import type { OAuthGrantListItem } from "@/hooks/use-oauth-grants";
import { formatDateTime } from "@/lib/format-utils";
import { oauthAppName, oauthAppNameStart } from "./oauth-labels";
import { clientIdHost, connectionPermissionSummary } from "./connected-app-permissions";

/** The settings roster row, as Members and Vehicles and crew list theirs: name and host, a quiet action, details below. */
export function ConnectedAppList({ grants, label, showMember, onDisconnect }: {
  grants: OAuthGrantListItem[];
  label: string;
  /** Adds who connected the app, for the Owner and Admin view. */
  showMember: boolean;
  onDisconnect: (grant: OAuthGrantListItem) => void;
}) {
  return (
    <OrganizationRosterList label={label}>
      {grants.map(grant => (
        <OrganizationRosterRow
          key={grant.id}
          primary={oauthAppNameStart(grant.name)}
          secondary={clientIdHost(grant.clientId) ?? undefined}
          actions={
            <Button variant="destructive" size="small" aria-label={`Disconnect ${oauthAppName(grant.name)}${showMember ? ` for ${grant.memberName}` : ""}`}
              onClick={() => onDisconnect(grant)}>Disconnect</Button>
          }
          details={
            <OrganizationRosterDetails items={[
              ...(showMember ? [{ label: "Member", value: grant.memberName }] : []),
              { label: "Permissions", value: connectionPermissionSummary(grant.scopes ?? []) },
              { label: "Connected", value: formatDateTime(grant.createdAt) },
              { label: "Last used", value: formatDateTime(grant.lastUsedAt) },
            ]} />
          }
        />
      ))}
    </OrganizationRosterList>
  );
}
