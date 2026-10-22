"use client";

import { useState } from "react";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { ChoiceCardGroup } from "@/components/forms";
import { Button, EmptyState } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { useOAuthOrganizationChoices, useSelectOAuthOrganization } from "@/hooks/use-oauth-flow";
import { useOAuthQuery } from "@/hooks/use-oauth-query";
import { followOAuthContinuation } from "@/lib/auth/oauth-continuation";
import { OAuthAppIdentity, OAuthCard, OAuthRestartNotice } from "./oauth-card";
import { oauthAppNameStart, oauthRoleLabel } from "./oauth-labels";

const EMPTY_ICON_SIZE = 32;
const TITLE = "Choose an organization";
const EMPTY_TITLE = "No organizations yet";
const EMPTY_DESCRIPTION = "Ask an Admin to invite you.";
const EMPTY_ADMIN_TITLE = "Join an organization first";
const EMPTY_ADMIN_DESCRIPTION = "Apps connect as a member of an organization. Platform Admins are not members, so invite yourself to one in Settings, then connect again.";

export function OrganizationPicker() {
  // The signed query is the request's identity; it exists only in the browser.
  const oauthQuery = useOAuthQuery();
  const choices = useOAuthOrganizationChoices(oauthQuery);
  const select = useSelectOAuthOrganization(oauthQuery ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  // Busy from the click until the page leaves for the app; only a failure clears it.
  const busy = useBusyUntilUnload();

  if (oauthQuery === "" || choices.isError) return <OAuthCard title={TITLE}><OAuthRestartNotice /></OAuthCard>;
  if (!choices.data) return <OAuthCard title={TITLE}><Skeleton className="h-160 w-full" /></OAuthCard>;

  const { clientName, clientHost, memberships, preselectedOrganizationId, isPlatformAdmin } = choices.data;
  const selected = picked ?? preselectedOrganizationId;
  const usable = memberships.some(membership => !membership.disabledReason);

  async function submit(organizationId: string) {
    if (busy.held) return;
    setRefused(false);
    busy.hold(true);
    try {
      const url = await select.mutateAsync(organizationId);
      if (followOAuthContinuation(url, new URLSearchParams(oauthQuery ?? ""))) return;
    } catch { /* The restart notice below covers a refused request. */ }
    busy.release();
    setRefused(true);
  }

  return (
    <OAuthCard title={TITLE} intro={`${oauthAppNameStart(clientName)} will act for you in one organization. To use another, connect again.`}>
      <OAuthAppIdentity name={clientName} host={clientHost} />
      {memberships.length === 0 ? (
        <EmptyState icon={<BuildingsIcon size={EMPTY_ICON_SIZE} />} padding="sm"
          title={isPlatformAdmin ? EMPTY_ADMIN_TITLE : EMPTY_TITLE}
          description={isPlatformAdmin ? EMPTY_ADMIN_DESCRIPTION : EMPTY_DESCRIPTION} />
      ) : (
        <form className="flex flex-col gap-24" onSubmit={event => { event.preventDefault(); if (selected) void submit(selected); }}>
          <ChoiceCardGroup
            legend="Organization"
            className="grid-cols-1!"
            value={selected ?? ""}
            onValueChange={setPicked}
            disabled={!!busy.held}
            options={memberships.map(membership => ({
              value: membership.organizationId,
              title: membership.name,
              description: membership.disabledReason
                ? `${oauthRoleLabel(membership.role)}. ${membership.disabledReason}` : oauthRoleLabel(membership.role),
              disabled: !!membership.disabledReason,
            }))}
          />
          {refused && <OAuthRestartNotice />}
          <div className="flex justify-start">
            <Button type="submit" variant="primary" size="large" busy={!!busy.held} disabled={!usable || !selected}>Continue</Button>
          </div>
        </form>
      )}
    </OAuthCard>
  );
}
