/** Dashboard setup mode, record-derived progress, and the scoped collapse preference. */
"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth/client";
import { useOnboardingStatus } from "@/hooks/use-onboarding";
import type { OnboardingStatus } from "@/data-access/onboarding";
import { onboardingGuideCollapsedKey } from "./onboarding-constants";
import { deriveSetupProgress, type SetupProgress } from "./use-setup-steps";

/**
 * - `takeover-guide` — Owner/Admin, setup incomplete: the guide IS the body.
 * - `takeover-member` — Member, setup incomplete: the calm "in progress" note.
 * - `strip` — Owner/Admin collapsed the guide: slim strip above the real body.
 * - `loading` — status is unresolved: hold the onboarding-shaped placeholder.
 * - `none` — nothing to show; the real dashboard renders as usual.
 */
export type OnboardingMode =
  | "takeover-guide"
  | "takeover-member"
  | "strip"
  | "loading"
  | "none";

export interface SetupGuideState {
  isLoading: boolean;
  status: OnboardingStatus | undefined;
  progress: SetupProgress;
  mode: OnboardingMode;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

function readBooleanFlag(key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBooleanFlag(
  key: string,
  value: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    const store = window.localStorage;
    if (value) store.setItem(key, "true");
    else store.removeItem(key);
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}

export function useSetupGuide(
  facilityId: string | null,
  organizationId: string | null,
): SetupGuideState {
  const { data: status, isPending, isFetching, isFetchedAfterMount } = useOnboardingStatus(
    facilityId,
    organizationId,
  );
  const { data: sessionData, isPending: isSessionPending } = authClient.useSession();
  // Revisited cached counts cannot decide a takeover until the first refresh
  // settles. Later refreshes keep the already-validated dashboard visible.
  // An unresolved session waits; a resolved session with no active organization
  // leaves the ordinary organization/facility selection surface available.
  const isLoading = organizationId === null
    ? isSessionPending
    : isPending || (isFetching && !isFetchedAfterMount);

  const progress = deriveSetupProgress(status, facilityId);

  const userId = sessionData?.user?.id ?? null;
  // The collapse preference is persistent (localStorage) but must not leak
  // across accounts or organizations sharing a browser, so it scopes by user
  // (not session — it survives re-login by design) and org.
  const collapsedKey = userId
    ? onboardingGuideCollapsedKey(userId, organizationId)
    : null;

  // The persisted preference reads lazily, re-read whenever its scoped key
  // changes (session resolves, org switches) using the render-adjustment pattern,
  // so no effect is needed. Hydration-safe: it only influences the rendered
  // output once the status query has resolved (post-hydration). The loading
  // mode does not read the flag, so the server's `false` first paint never
  // mismatches the client.
  const [readCollapsedKey, setReadCollapsedKey] = useState<string | null>(null);
  const [collapsed, setCollapsedState] = useState(false);
  if (readCollapsedKey !== collapsedKey) {
    setReadCollapsedKey(collapsedKey);
    setCollapsedState(
      collapsedKey ? readBooleanFlag(collapsedKey) : false,
    );
  }
  const setCollapsed = (next: boolean) => {
    if (collapsedKey) writeBooleanFlag(collapsedKey, next);
    setCollapsedState(next);
  };

  const mode = resolveMode({
    isLoading,
    status,
    facilityId,
    progress,
    collapsed,
  });

  return {
    isLoading,
    status,
    progress,
    mode,
    collapsed,
    setCollapsed,
  };
}

// Exported for the colocated unit test — the dashboard consumes it via
// `useSetupGuide` only.
export function resolveMode({
  isLoading,
  status,
  facilityId,
  progress,
  collapsed,
}: {
  isLoading: boolean;
  status: OnboardingStatus | undefined;
  facilityId: string | null;
  progress: SetupProgress;
  collapsed: boolean;
}): OnboardingMode {
  if (isLoading) return "loading";
  if (!status) return "none";

  // Fresh org, no facility yet: the guide is the landing surface. A Member waits.
  if (status.facilityCount === 0) {
    return status.isOwnerOrAdmin ? "takeover-guide" : "takeover-member";
  }

  // Facilities exist but none is selected — the normal "select a facility"
  // gate owns this; onboarding stays out of the way.
  if (!facilityId) return "none";

  if (progress.allComplete) return "none";

  // A Member is only blocked while the facility is genuinely pre-operational
  // (no reactor yet). Later Setup steps — registry (admin-managed and
  // legitimately skippable), supplier, first runs — can stay open for a long
  // time on a producing facility, and a Member must not be locked out of the
  // dashboard for them.
  if (!status.isOwnerOrAdmin) {
    const operational = (status.facility?.reactorCount ?? 0) > 0;
    return operational ? "none" : "takeover-member";
  }

  // Owner/Admin: the registry step is legitimately skippable (lines above), so
  // once every REQUIRED step is done the facility is fully operational even if
  // Isometric was never connected. Recede to the real dashboard — the guide
  // still lists registry as incomplete, it just no longer takes over the page.
  // Without this, an org that never connects a registry keeps a permanent 6/7
  // strip/takeover, hiding HeroKpiBand/FlowHero forever.
  if (progress.requiredComplete) return "none";

  return collapsed ? "strip" : "takeover-guide";
}
