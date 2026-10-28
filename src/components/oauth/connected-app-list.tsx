"use client";

import { OrganizationRosterDetails, OrganizationRosterList, OrganizationRosterRow } from "@/components/organizations/organization-roster-list";
import { Button } from "@/components/ui";
import type { OAuthGrantListItem } from "@/hooks/use-oauth-grants";
// Account/organization security metadata has no facility clock.
import { formatDateTime } from "@/lib/format-utils";
import { oauthAppName, oauthAppNameStart } from "./oauth-labels";
import { clientIdHost, connectionPermissionSummary } from "./connected-app-permissions";

/** An app names itself, so the host is the one thing a person can verify: it always shows in full, never truncated. */
const WRAP_HOST = "whitespace-normal break-all";
const WRAP_NAME = "whitespace-normal break-words";

/** The settings roster row, as Members and Vehicles and crew list theirs: name and host, a quiet action, details below. */
export function ConnectedAppList({ grants, label, showMember, onDisconnect }: {
  grants: OAuthGrantListItem[];
  label: string;
  /** Adds who connected the app, for the Admin view. */
  showMember: boolean;
  onDisconnect: (grant: OAuthGrantListItem) => void;
}) {
  return (
    <OrganizationRosterList label={label}>
      {grants.map(grant => (
        <OrganizationRosterRow
          key={grant.id}
          primary={oauthAppNameStart(grant.name)}
          primaryClassName={WRAP_NAME}
          secondary={clientIdHost(grant.clientId) ?? undefined}
          secondaryClassName={WRAP_HOST}
          actions={
            <Button variant="destructive" aria-label={`Disconnect ${oauthAppName(grant.name)}${showMember ? ` for ${grant.memberName}` : ""}`}
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
