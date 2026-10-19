"use client";

import { useState } from "react";
import { PlugsConnectedIcon } from "@phosphor-icons/react/dist/ssr";
import { ServerError } from "@/components/forms";
import { Button, EmptyState, Notice } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useOAuthGrants, type OAuthGrantListItem } from "@/hooks/use-oauth-grants";
import { ConnectedAppList } from "./connected-app-list";
import { DisconnectAppDialog } from "./disconnect-app-dialog";

const EMPTY_ICON_SIZE = 32;

interface ConnectedAppsProps {
  organizationId: string;
  organizationName: string;
  userId: string;
  /** Live Owner or Admin membership: adds the All members list. */
  canManageAll: boolean;
  /** A live membership of the active organization. Platform status alone has none. */
  isMember: boolean;
}

export function ConnectedApps({ isMember, ...props }: ConnectedAppsProps) {
  if (!isMember) return <Notice tone="info">Only members of this organization can connect apps. Ask an Owner to invite you.</Notice>;
  return <ConnectedAppsManager key={props.organizationId} {...props} />;
}

function ConnectedAppsManager({ organizationId, organizationName, userId, canManageAll }: Omit<ConnectedAppsProps, "isMember">) {
  const query = useOAuthGrants(organizationId);
  // The dialog reads the freshest row, so a retry after a stale refusal carries the refreshed version.
  const [disconnecting, setDisconnecting] = useState<OAuthGrantListItem | null>(null);

  if (query.isLoading && !query.data) return <Skeleton className="h-320 w-full" />;
  if (query.isError || !query.data) {
    return <ServerError message="Connected apps could not be loaded. Check your connection and try again."
      action={<Button onClick={() => { void query.refetch(); }}>Try again</Button>} />;
  }
  // Owners and Admins receive every member's connections; their own are the subset they hold.
  const own = query.data.filter(grant => grant.userId === userId);

  return (
    <div className="flex flex-col gap-32">
      <section className="flex flex-col gap-16" aria-labelledby="connected-apps-own">
        <h3 id="connected-apps-own" className="title-heading-3">Your connections</h3>
        {own.length === 0 ? (
          <EmptyState icon={<PlugsConnectedIcon size={EMPTY_ICON_SIZE} />} padding="sm" title="No connected apps"
            description="Apps you connect to noma, such as Claude, appear here." />
        ) : <ConnectedAppList grants={own} label="Your connections" showMember={false} onDisconnect={setDisconnecting} />}
      </section>
      {canManageAll && (
        <section className="flex flex-col gap-16" aria-labelledby="connected-apps-all">
          <h3 id="connected-apps-all" className="title-heading-3">All members</h3>
          {query.data.length === 0 ? (
            <EmptyState icon={<PlugsConnectedIcon size={EMPTY_ICON_SIZE} />} padding="sm" title="No connected apps"
              description="Apps that members connect to this organization appear here." />
          ) : <ConnectedAppList grants={query.data} label="All members" showMember onDisconnect={setDisconnecting} />}
        </section>
      )}
      {disconnecting && (
        <DisconnectAppDialog grant={query.data.find(grant => grant.id === disconnecting.id) ?? disconnecting} organizationId={organizationId} organizationName={organizationName}
          onClose={() => setDisconnecting(null)} />
      )}
    </div>
  );
}
