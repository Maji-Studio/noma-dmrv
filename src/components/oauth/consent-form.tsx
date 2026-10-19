"use client";

import { useState } from "react";
import Link from "next/link";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { ApiKeyPermissionGrid } from "@/components/api-keys/api-key-permission-grid";
import { permissionSummary } from "@/components/api-keys/api-key-permissions";
import { Button } from "@/components/ui";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { useOAuthConsentDecision, useOAuthConsentView, type OAuthConsentView } from "@/hooks/use-oauth-flow";
import type { ApiScope } from "@/lib/auth/api-scopes";
import { useOAuthQuery } from "@/hooks/use-oauth-query";
import { followOAuthContinuation } from "@/lib/auth/oauth-continuation";
import { SETTINGS_CONNECTED_APPS_HREF } from "@/lib/settings/links";
import { OAuthAppIdentity, OAuthCard, OAuthRestartNotice } from "./oauth-card";
import { oauthAppName, oauthAppNameStart } from "./oauth-labels";

/** An already allowed group longer than this many entities folds away. The request itself never does. */
const ALLOWED_FOLD_LIMIT = 5;
const CONSENT_ACTIONS = ["read", "write"] as const;
const CARET_SIZE = 14;
const OFFLINE_ACCESS = "offline_access";
const TITLE_FALLBACK = "Allow this app to use noma?";
const CHECKBOX_CLASS = "size-16 cursor-pointer accent-[var(--color-interaction)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-interaction)]";

const isRead = (scope: string) => scope.endsWith(":read");

export function ConsentForm() {
  const oauthQuery = useOAuthQuery();
  const view = useOAuthConsentView(oauthQuery);
  if (oauthQuery === "" || view.isError) return <OAuthCard title={TITLE_FALLBACK}><OAuthRestartNotice /></OAuthCard>;
  if (!view.data) return <OAuthCard title={TITLE_FALLBACK}><Skeleton className="h-160 w-full" /></OAuthCard>;
  return <ConsentBody view={view.data} oauthQuery={oauthQuery ?? ""} />;
}

function ConsentBody({ view, oauthQuery }: { view: OAuthConsentView; oauthQuery: string }) {
  const { clientHost, redirectHost, organization, isStepUp, offlineAccessRequested } = view;
  const clientName = oauthAppName(view.clientName);
  const newScopes = view.newlyRequestedScopes as ApiScope[];
  const allowed = view.alreadyAllowedScopes as ApiScope[];
  // Q91: a first connection starts with reads ticked; writes are ticked only
  // when an existing connection asks for them, because the person asked for that action.
  const [ticked, setTicked] = useState<ApiScope[]>(() => isStepUp ? newScopes : newScopes.filter(isRead));
  const [failed, setFailed] = useState(false);
  const decision = useOAuthConsentDecision(oauthQuery);

  const requestedReads = newScopes.filter(isRead);
  const tickedReads = requestedReads.filter(scope => ticked.includes(scope));
  const allReadsTicked = requestedReads.length > 0 && tickedReads.length === requestedReads.length;
  const allowedEntityCount = new Set(allowed.map(scope => scope.split(":")[0])).size;

  const submittedScopes = [...new Set<string>([...allowed, ...ticked])].filter(scope => scope !== OFFLINE_ACCESS);

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
    <OAuthCard title={`Allow ${clientName} to use noma?`}
      intro={`${oauthAppNameStart(view.clientName)}${clientHost ? ` (${clientHost})` : ""} wants to act for you in ${organization.name}.`}>
      <OAuthAppIdentity name={view.clientName} host={clientHost} redirectHost={redirectHost} />
      <div className="flex flex-col gap-12">
        {requestedReads.length > 0 && (
          <label className="flex min-h-44 cursor-pointer items-center gap-12">
            <input type="checkbox" className={CHECKBOX_CLASS} checked={allReadsTicked}
              ref={input => { if (input) input.indeterminate = tickedReads.length > 0 && !allReadsTicked; }}
              disabled={decision.isPending}
              onChange={event => setTicked(event.target.checked
                ? [...new Set([...ticked, ...requestedReads])] : ticked.filter(scope => !isRead(scope)))} />
            <span className="body-medium">Allow reading everything listed</span>
          </label>
        )}
        {/* What the app asks for now is always on screen: it is the decision. */}
        <ApiKeyPermissionGrid value={ticked} onChange={setTicked} disabled={decision.isPending}
          scopes={newScopes} actions={CONSENT_ACTIONS} hideLegend
          idPrefix="oauth-consent-permissions" caption={`Permissions ${clientName} asks for, by entity`} />
        {allowed.length > 0 && <AlreadyAllowed scopes={allowed} entityCount={allowedEntityCount} />}
      </div>
      {offlineAccessRequested && (
        <p className="body-small text-[var(--color-text-secondary)]">
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

/** What the connection already covers. Long lists fold; a short one stays open. */
function AlreadyAllowed({ scopes, entityCount }: { scopes: ApiScope[]; entityCount: number }) {
  const summary = permissionSummary(scopes);
  if (entityCount <= ALLOWED_FOLD_LIMIT) {
    return (
      <div className="flex flex-col gap-4">
        <p className="body-small font-medium">Already allowed</p>
        <p className="body-small text-[var(--color-text-secondary)]">{summary}</p>
      </div>
    );
  }
  return (
    <details className="group">
      <summary className="flex min-h-44 cursor-pointer list-none items-center gap-8 body-small font-medium [&::-webkit-details-marker]:hidden">
        <CaretRightIcon size={CARET_SIZE} aria-hidden className="transition-transform group-open:rotate-90" />
        Already allowed ({entityCount})
      </summary>
      <p className="body-small text-[var(--color-text-secondary)]">{summary}</p>
    </details>
  );
}
