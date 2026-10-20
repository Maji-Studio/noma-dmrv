"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useOAuthConsentDecision, useOAuthConsentView, type OAuthConsentView } from "@/hooks/use-oauth-flow";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { useOAuthQuery } from "@/hooks/use-oauth-query";
import { followOAuthContinuation } from "@/lib/auth/oauth-continuation";
import { SETTINGS_CONNECTED_APPS_HREF } from "@/lib/settings/links";
import { buildConsentAreas, isReadScope } from "./consent-areas";
import { ConsentChoices, type ConsentPreset } from "./consent-choices";
import { ConsentPegBoard } from "./consent-peg-board";
import { OAuthAppIdentity, OAuthCard, OAuthRestartNotice } from "./oauth-card";
import { oauthAppName } from "./oauth-labels";

const OFFLINE_ACCESS = "offline_access";
const TITLE_FALLBACK = "Allow this app to use noma?";

export function ConsentForm() {
  const oauthQuery = useOAuthQuery();
  const view = useOAuthConsentView(oauthQuery);
  if (oauthQuery === "" || view.isError) return <OAuthCard title={TITLE_FALLBACK}><OAuthRestartNotice /></OAuthCard>;
  if (!view.data) return <OAuthCard title={TITLE_FALLBACK}><Skeleton className="h-160 w-full" /></OAuthCard>;
  return <ConsentBody view={view.data} oauthQuery={oauthQuery ?? ""} />;
}

function ConsentBody({ view, oauthQuery }: { view: OAuthConsentView; oauthQuery: string }) {
  const { clientHost, redirectHost, organization, offlineAccessRequested } = view;
  const clientName = oauthAppName(view.clientName);
  const newScopes = view.newlyRequestedScopes as ApiScope[];
  const allowed = view.alreadyAllowedScopes as ApiScope[];
  const stepUpScopes = view.stepUpScopes as ApiScope[];
  const areas = buildConsentAreas([...newScopes, ...allowed]);
  const newReads = newScopes.filter(isReadScope);
  const writeAreas = areas.filter((area) => area.write && newScopes.includes(area.write)).length;
  // A stored consent means the board alone: the person is adding to what the app already has.
  const hasConsent = view.isStepUp || allowed.length > 0;
  // Step-up ticks only what a recent refusal asked for (plus the read it needs), since discovery may request every scope.
  const [ticked, setTicked] = useState<ApiScope[]>(() => hasConsent
    ? newScopes.filter((scope) => stepUpScopes.includes(scope) || areas.some((area) => area.read === scope && area.write && stepUpScopes.includes(area.write)))
    : newReads);
  const [preset, setPreset] = useState<ConsentPreset>("read");
  const [failed, setFailed] = useState(false);
  const decision = useOAuthConsentDecision(oauthQuery);

  const submittedScopes = [...new Set<string>([...allowed, ...ticked])].filter((scope) => scope !== OFFLINE_ACCESS);
  const newAreas = new Set(hasConsent ? areas.filter((area) => [area.read, area.write].some((scope) => scope && stepUpScopes.includes(scope))).map((area) => area.entity) : []);

  function choose(next: ConsentPreset) {
    setPreset(next);
    if (next === "read") setTicked(newReads);
    else if (next === "write") setTicked(newScopes);
  }

  async function decide(accept: boolean) {
    setFailed(false);
    // Accepting replaces the stored consent, so the already allowed scopes stay in it.
    const scope = accept ? [...submittedScopes, ...(offlineAccessRequested ? [OFFLINE_ACCESS] : [])].join(" ") : undefined;
    try {
      const url = await decision.mutateAsync({ accept, scope });
      if (!followOAuthContinuation(url, new URLSearchParams(oauthQuery))) setFailed(true);
    } catch { setFailed(true); }
  }

  return (
    // The card names the app and its host, so the intro only adds where it will act.
    <OAuthCard title={`Allow ${clientName} to use noma?`} intro={`It wants to act for you in ${organization.name}.`}>
      <OAuthAppIdentity name={view.clientName} host={clientHost} redirectHost={redirectHost} />
      {!hasConsent && (
        <ConsentChoices clientName={clientName} readAreas={areas.filter((area) => area.read && newReads.includes(area.read)).length}
          writeAreas={writeAreas} value={preset} onChange={choose} disabled={decision.isPending} />
      )}
      {(hasConsent || preset === "custom") && (
        <ConsentPegBoard areas={areas} allowed={allowed} undecided={newScopes} newAreas={newAreas} ticked={ticked}
          onChange={setTicked} clientName={clientName} disabled={decision.isPending} />
      )}
      {offlineAccessRequested && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          Stay connected: {clientName} can keep working without asking you to sign in again
        </p>
      )}
      {failed && <OAuthRestartNotice />}
      <div className="flex justify-start gap-16">
        <Button variant="primary" size="large" busy={decision.isPending} disabled={submittedScopes.length === 0} onClick={() => void decide(true)}>Allow</Button>
        <Button size="large" disabled={decision.isPending} onClick={() => void decide(false)}>Deny</Button>
      </div>
      <p className="body-caption text-[var(--color-text-tertiary)]">
        You can disconnect at any time in <Link href={SETTINGS_CONNECTED_APPS_HREF} target="_blank" rel="noopener" className="underline">Settings, Connected apps</Link>.
      </p>
    </OAuthCard>
  );
}
