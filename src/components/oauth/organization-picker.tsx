"use client";

import { useState } from "react";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { ChoiceCardGroup } from "@/components/forms";
import { Button, EmptyState } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useOAuthOrganizationChoices, useSelectOAuthOrganization } from "@/hooks/use-oauth-flow";
import { useOAuthQuery } from "@/hooks/use-oauth-query";
import { followOAuthContinuation } from "@/lib/auth/oauth-continuation";
import { OAuthAppIdentity, OAuthCard, OAuthRestartNotice } from "./oauth-card";
import { oauthAppNameStart, oauthRoleLabel } from "./oauth-labels";

const EMPTY_ICON_SIZE = 32;
const TITLE = "Choose an organization";

export function OrganizationPicker() {
  // The signed query is the request's identity; it exists only in the browser.
  const oauthQuery = useOAuthQuery();
  const choices = useOAuthOrganizationChoices(oauthQuery);
  const select = useSelectOAuthOrganization(oauthQuery ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);

  if (oauthQuery === "" || choices.isError) return <OAuthCard title={TITLE}><OAuthRestartNotice /></OAuthCard>;
  if (!choices.data) return <OAuthCard title={TITLE}><Skeleton className="h-160 w-full" /></OAuthCard>;

  const { clientName, clientHost, memberships, preselectedOrganizationId } = choices.data;
  const selected = picked ?? preselectedOrganizationId;
  const usable = memberships.some(membership => !membership.disabledReason);

  async function submit(organizationId: string) {
    setRefused(false);
    try {
      const url = await select.mutateAsync(organizationId);
      if (!followOAuthContinuation(url, new URLSearchParams(oauthQuery ?? ""))) setRefused(true);
    } catch { setRefused(true); }
  }

  return (
    <OAuthCard title={TITLE} intro={`${oauthAppNameStart(clientName)} will act for you in one organization. To use another, connect again.`}>
      <OAuthAppIdentity name={clientName} host={clientHost} />
      {memberships.length === 0 ? (
        <EmptyState icon={<BuildingsIcon size={EMPTY_ICON_SIZE} />} padding="sm"
          title="You are not a member of an organization yet. Ask an Owner to invite you." />
      ) : (
        <form className="flex flex-col gap-24" onSubmit={event => { event.preventDefault(); if (selected) void submit(selected); }}>
          <ChoiceCardGroup
            legend="Organization"
            className="grid-cols-1!"
            value={selected ?? ""}
            onValueChange={setPicked}
            disabled={select.isPending}
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
            <Button type="submit" variant="primary" size="large" busy={select.isPending} disabled={!usable || !selected}>Continue</Button>
          </div>
        </form>
      )}
    </OAuthCard>
  );
}
