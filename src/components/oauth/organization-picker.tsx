"use client";

import { useId, useRef, useState } from "react";
import { BuildingsIcon } from "@phosphor-icons/react/dist/ssr";
import { ChoiceCardGroup, FormError } from "@/components/forms";
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
const CHOOSE_ERROR = "Choose an organization.";
const NONE_AVAILABLE_ERROR = "None of these organizations can connect apps. Each one says why.";
const EMPTY_ADMIN_TITLE = "Join an organization first";
const EMPTY_ADMIN_DESCRIPTION = "Apps connect as a member of an organization. Platform Admins are not members, so invite yourself to one in Settings, then connect again.";

export function OrganizationPicker() {
  // The signed query is the request's identity; it exists only in the browser.
  const oauthQuery = useOAuthQuery();
  const choices = useOAuthOrganizationChoices(oauthQuery);
  const select = useSelectOAuthOrganization(oauthQuery ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [missing, setMissing] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorId = useId();
  // Busy from the click until the page leaves for the app; only a failure clears it.
  const busy = useBusyUntilUnload();

  if (oauthQuery === "" || choices.isError) return <OAuthCard title={TITLE}><OAuthRestartNotice /></OAuthCard>;
  if (!choices.data) return <OAuthCard title={TITLE}><Skeleton className="h-160 w-full" /></OAuthCard>;

  const { clientName, clientHost, memberships, preselectedOrganizationId, isPlatformAdmin } = choices.data;
  const selected = picked ?? preselectedOrganizationId;
  const usable = memberships.some(membership => !membership.disabledReason);

  function submitChosen() {
    if (selected) { void submit(selected); return; }
    setMissing(true);
    // The radios are one tab stop, so focusing the first available one lands on the group.
    formRef.current?.querySelector<HTMLInputElement>("input[type=radio]:not(:disabled)")?.focus();
  }

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
        <form ref={formRef} className="flex flex-col gap-24" onSubmit={event => { event.preventDefault(); submitChosen(); }}>
          <div>
            <ChoiceCardGroup
              legend="Organization"
              className="grid-cols-1!"
              value={selected ?? ""}
              onValueChange={value => { setMissing(false); setPicked(value); }}
              error={missing}
              aria-describedby={missing ? errorId : undefined}
              disabled={!!busy.held}
              options={memberships.map(membership => ({
                value: membership.organizationId,
                title: membership.name,
                description: membership.disabledReason
                  ? `${oauthRoleLabel(membership.role)}. ${membership.disabledReason}` : oauthRoleLabel(membership.role),
                disabled: !!membership.disabledReason,
              }))}
            />
            <FormError id={errorId} message={missing ? (usable ? CHOOSE_ERROR : NONE_AVAILABLE_ERROR) : undefined} />
          </div>
          {refused && <OAuthRestartNotice />}
          <div className="flex justify-start">
            <Button type="submit" variant="primary" size="large" busy={!!busy.held}>Continue</Button>
          </div>
        </form>
      )}
    </OAuthCard>
  );
}
