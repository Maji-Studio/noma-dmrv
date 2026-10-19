"use client";

import { Button } from "@/components/ui";
import type { OAuthGrantListItem } from "@/hooks/use-oauth-grants";
import { formatDateTime } from "@/lib/format-utils";
import { oauthAppName, oauthAppNameStart } from "./oauth-labels";
import { clientIdHost, connectionPermissionSummary } from "./connected-app-permissions";

export function ConnectedAppList({ grants, label, showMember, onDisconnect }: {
  grants: OAuthGrantListItem[];
  label: string;
  /** Adds who connected the app, for the Owner and Admin view. */
  showMember: boolean;
  onDisconnect: (grant: OAuthGrantListItem) => void;
}) {
  return (
    <ul className="flex flex-col gap-16" aria-label={label}>
      {grants.map(grant => {
        const host = clientIdHost(grant.clientId);
        return (
          <li key={grant.id} className="border border-[var(--color-border-secondary)] p-16 flex flex-col gap-12">
            <div className="flex flex-col gap-4">
              <h4 className="body-medium font-medium break-words">{oauthAppNameStart(grant.name)}</h4>
              {host && <p className="body-small text-[var(--color-text-secondary)] break-all">{host}</p>}
            </div>
            <dl className="grid grid-cols-1 gap-12 sm:grid-cols-2 body-small">
              {showMember && <div className="sm:col-span-2"><dt className="text-[var(--color-text-tertiary)]">Member</dt><dd>{grant.memberName}</dd></div>}
              <div className="sm:col-span-2"><dt className="text-[var(--color-text-tertiary)]">Permissions</dt><dd>{connectionPermissionSummary(grant.scopes ?? [])}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Connected</dt><dd>{formatDateTime(grant.createdAt)}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Last used</dt><dd>{formatDateTime(grant.lastUsedAt)}</dd></div>
            </dl>
            <div className="flex flex-wrap gap-12">
              <Button variant="destructive" aria-label={`Disconnect ${oauthAppName(grant.name)}${showMember ? ` for ${grant.memberName}` : ""}`}
                onClick={() => onDisconnect(grant)}>Disconnect</Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
