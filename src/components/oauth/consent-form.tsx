"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { FormError } from "@/components/forms/form-error";
import { Button } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useBusyUntilUnload } from "@/hooks/use-busy-until-unload";
import { useOAuthConsentDecision, useOAuthConsentView, type OAuthConsentView } from "@/hooks/use-oauth-flow";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { useOAuthQuery } from "@/hooks/use-oauth-query";
import { followOAuthContinuation } from "@/lib/auth/oauth-continuation";
import { SETTINGS_CONNECTED_APPS_HREF } from "@/lib/settings/links";
import { buildConsentAreas, isReadScope, preselectStepUp, seedFromStored } from "./consent-areas";
import { ConsentChoices, type ConsentPreset } from "./consent-choices";
import { ConsentPegBoard } from "./consent-peg-board";
import { OAuthAppIdentity, OAuthCard, OAuthRestartNotice } from "./oauth-card";
import { oauthAppName } from "./oauth-labels";

const OFFLINE_ACCESS = "offline_access";
const NO_PERMISSION_ERROR = "Choose at least one permission.";
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
  const requested = [...view.newlyRequestedScopes, ...view.alreadyAllowedScopes] as ApiScope[];
  // A step-up (a live refusal hint) keeps the stored consent and adds to it. Any other connect is a fresh choice:
  // claude.ai sends no revoke on Disconnect, so a stored consent must not lock the person in.
  const stepUp = view.isStepUp;
  const allowed = (stepUp ? view.alreadyAllowedScopes : []) as ApiScope[];
  const undecided = stepUp ? view.newlyRequestedScopes as ApiScope[] : requested;
  const stepUpScopes = view.stepUpScopes as ApiScope[];
  const areas = buildConsentAreas(requested);
  const undecidedReads = undecided.filter(isReadScope);
  const writeAreas = areas.filter((area) => area.write && undecided.includes(area.write)).length;
  // Step-up ticks only what a recent refusal asked for (plus the read it needs), since discovery may request every scope.
  // A fresh choice starts from the stored consent, so a quick Allow never drops writes the person already gave.
  const [seed] = useState(() => seedFromStored(areas, requested, view.alreadyAllowedScopes as ApiScope[]));
  const [ticked, setTicked] = useState<ApiScope[]>(() => stepUp
    ? preselectStepUp(areas, undecided, stepUpScopes)
    : seed.ticked);
  const [preset, setPreset] = useState<ConsentPreset>(stepUp ? "read" : seed.preset);
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const choicesRef = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const decision = useOAuthConsentDecision(oauthQuery);
  // Busy from the click until the page leaves for the app, not just until the request returns; only a failure clears it.
  const busy = useBusyUntilUnload<"allow" | "deny">();
  const deciding = busy.held !== null;

  const submittedScopes = [...new Set<string>([...allowed, ...ticked])].filter((scope) => scope !== OFFLINE_ACCESS);
  const showError = missing && submittedScopes.length === 0;
  const showBoard = stepUp || preset === "custom";
  const hasPegs = areas.some((area) => [area.read, area.write].some((scope) => scope && undecided.includes(scope)));
  // A request with no readable area leaves the board without pegs, so the cards carry the error then.
  const cardsInvalid = showError && (!showBoard || !hasPegs);
  const newAreas = new Set(stepUp ? areas.filter((area) => [area.read, area.write].some((scope) => scope && stepUpScopes.includes(scope))).map((area) => area.entity) : []);

  function choose(next: ConsentPreset) {
    setPreset(next);
    if (next === "read") setTicked(undecidedReads);
    else if (next === "write") setTicked(undecided.filter((scope) => areas.some((area) => area.read === scope || area.write === scope)));
  }

  async function decide(accept: boolean) {
    if (deciding) return;
    if (accept && submittedScopes.length === 0) {
      setMissing(true);
      // Focus the first permission control: a tick box on the board, else the first choice.
      const field = choicesRef.current;
      (field?.querySelector<HTMLInputElement>("input[type=checkbox]:not(:disabled)") ?? field?.querySelector<HTMLInputElement>("input:not(:disabled)"))?.focus();
      return;
    }
    setMissing(false);
    setFailed(false);
    busy.hold(accept ? "allow" : "deny");
    // Accepting replaces the stored consent: a step-up keeps the allowed scopes, a fresh choice submits only what is ticked.
    const scope = accept ? [...submittedScopes, ...(offlineAccessRequested ? [OFFLINE_ACCESS] : [])].join(" ") : undefined;
    try {
      const url = await decision.mutateAsync({ accept, scope });
      if (followOAuthContinuation(url, new URLSearchParams(oauthQuery))) return;
    } catch { /* The restart notice below covers a refused request. */ }
    busy.release();
    setFailed(true);
  }

  return (
    // The card names the app and its host, so the intro only adds where it will act.
    <OAuthCard title={`Allow ${clientName} to use noma?`} intro={`It wants to act for you in ${organization.name}.`}>
      <OAuthAppIdentity name={view.clientName} host={clientHost} redirectHost={redirectHost} />
      <div ref={choicesRef}>
        <div className="flex flex-col gap-24">
          {!stepUp && (
            <ConsentChoices clientName={clientName} readAreas={areas.filter((area) => area.read && undecidedReads.includes(area.read)).length}
              writeAreas={writeAreas} value={preset} onChange={choose} disabled={deciding}
              error={cardsInvalid} errorId={cardsInvalid ? errorId : undefined} />
          )}
          {showBoard && (
            <ConsentPegBoard areas={areas} allowed={allowed} undecided={undecided} newAreas={newAreas} ticked={ticked}
              onChange={setTicked} clientName={clientName} disabled={deciding} invalid={showError} errorId={errorId} />
          )}
        </div>
        <FormError id={errorId} message={showError ? NO_PERMISSION_ERROR : undefined} />
      </div>
      {offlineAccessRequested && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          Stay connected: {clientName} can keep working without asking you to sign in again
        </p>
      )}
      {failed && <OAuthRestartNotice />}
      <div className="flex justify-start gap-16">
        <Button variant="primary" size="large" busy={busy.held === "allow"} disabled={busy.held === "deny"} onClick={() => void decide(true)}>Allow</Button>
        <Button size="large" busy={busy.held === "deny"} disabled={deciding} onClick={() => void decide(false)}>Deny</Button>
      </div>
      <p className="body-caption text-[var(--color-text-tertiary)]">
        You can disconnect at any time in <Link href={SETTINGS_CONNECTED_APPS_HREF} target="_blank" rel="noopener" className="underline">Settings, Connected apps</Link>.
      </p>
    </OAuthCard>
  );
}
