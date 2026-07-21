/**
 * useOnboardingGate — the single decision point the dashboard reads to know
 * whether first-run onboarding should take over the page, recede to a strip,
 * or stay out of the way. It also owns the first-run wizard's open/dismiss
 * lifecycle so the guide and the wizard share one source of truth.
 *
 * Roles: Owner/Admin drive setup and see the wizard + guide; a plain Member in
 * a half-provisioned facility sees a calm "setup in progress" state instead.
 * The wizard auto-opens only for an Owner/Admin whose org has zero facilities,
 * and a dismiss suppresses re-open for the browser session (it re-opens next
 * session until a facility exists).
 */
"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onboardingKeys, useOnboardingStatus } from "@/hooks/use-onboarding";
import type { OnboardingStatus } from "@/data-access/onboarding";
import {
  ONBOARDING_GUIDE_COLLAPSED_KEY,
  ONBOARDING_WIZARD_DISMISSED_KEY,
} from "./onboarding-constants";
import { deriveSetupProgress, type SetupProgress } from "./use-setup-steps";

/**
 * - `takeover-guide` — Owner/Admin, setup incomplete: the guide IS the body.
 * - `takeover-member` — Member, setup incomplete: the calm "in progress" note.
 * - `strip` — Owner/Admin collapsed the guide: slim strip above the real body.
 * - `none` — nothing to show; the real dashboard renders as usual.
 */
export type OnboardingMode =
  | "takeover-guide"
  | "takeover-member"
  | "strip"
  | "none";

export interface OnboardingWizardControls {
  isOpen: boolean;
  /** Explicitly open (e.g. the guide's "add facility" CTA). Ignores dismissal. */
  open: () => void;
  /**
   * Latch the wizard open once it has actually opened (wired to the Modal's
   * `onOpen`). Auto-open derives `isOpen` from "no facility yet"; latching keeps
   * it open through the very facility creation that would otherwise flip that
   * derivation and close the wizard mid-flow.
   */
  latchOpen: () => void;
  /** Close and suppress auto-open for this browser session. */
  dismiss: () => void;
}

export interface OnboardingGate {
  isLoading: boolean;
  status: OnboardingStatus | undefined;
  progress: SetupProgress;
  mode: OnboardingMode;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  wizard: OnboardingWizardControls;
}

function readBooleanFlag(storage: "session" | "local", key: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const store =
      storage === "session" ? window.sessionStorage : window.localStorage;
    return store.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBooleanFlag(
  storage: "session" | "local",
  key: string,
  value: boolean,
): void {
  if (typeof window === "undefined") return;
  try {
    const store =
      storage === "session" ? window.sessionStorage : window.localStorage;
    if (value) store.setItem(key, "true");
    else store.removeItem(key);
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
}

export function useOnboardingGate(facilityId: string | null): OnboardingGate {
  const queryClient = useQueryClient();
  const { data: status, isLoading } = useOnboardingStatus(facilityId);

  const progress = deriveSetupProgress(status, facilityId);

  // Persisted preferences read lazily. Hydration-safe: both only influence the
  // rendered output once the status query has resolved (post-hydration) — until
  // then the gate mode is "none" and the guide/strip aren't rendered — so the
  // server's `false` first paint never mismatches the client.
  const [collapsed, setCollapsedState] = useState(() =>
    readBooleanFlag("local", ONBOARDING_GUIDE_COLLAPSED_KEY),
  );
  const [dismissed, setDismissed] = useState(() =>
    readBooleanFlag("session", ONBOARDING_WIZARD_DISMISSED_KEY),
  );
  // `null` defers to the auto-open derivation; a boolean is an explicit
  // open/close that overrides it. Derived, not effect-driven — the wizard is
  // "the org has no facility and the user hasn't dismissed it", latched open by
  // the Modal so creating the facility doesn't close it out from under the user.
  const [explicitOpen, setExplicitOpen] = useState<boolean | null>(null);

  // Auto-open interrupts with a modal, so it's reserved for the true
  // onboarding persona — a real org Owner/Admin. A platform admin browsing a
  // fresh org gets the guide takeover instead and can open the wizard from
  // its facility CTA.
  const autoOpenEligible =
    !!status && status.isOrgOwnerOrAdmin && status.facilityCount === 0;
  const isOpen =
    explicitOpen === null ? autoOpenEligible && !dismissed : explicitOpen;

  const setCollapsed = (next: boolean) => {
    writeBooleanFlag("local", ONBOARDING_GUIDE_COLLAPSED_KEY, next);
    setCollapsedState(next);
  };

  const wizard: OnboardingWizardControls = {
    isOpen,
    open: () => setExplicitOpen(true),
    latchOpen: () => setExplicitOpen(true),
    dismiss: () => {
      writeBooleanFlag("session", ONBOARDING_WIZARD_DISMISSED_KEY, true);
      setDismissed(true);
      setExplicitOpen(false);
      // Setup progress advanced inside the wizard (we defer the refetch to now
      // so a mid-flow refetch can't flip auto-open and close the modal) — re-read
      // it so the guide behind the modal reflects what was just created.
      void queryClient.invalidateQueries({ queryKey: onboardingKeys.all });
    },
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
    wizard,
  };
}

// Exported for the colocated unit test — the dashboard consumes it via
// `useOnboardingGate` only.
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
  if (isLoading || !status) return "none";

  // Fresh org, no facility yet: the wizard's landing pad. A Member waits.
  if (status.facilityCount === 0) {
    return status.isOwnerOrAdmin ? "takeover-guide" : "takeover-member";
  }

  // Facilities exist but none is selected — the normal "select a facility"
  // gate owns this; onboarding stays out of the way.
  if (!facilityId) return "none";

  if (progress.allComplete) return "none";

  // A Member is only blocked while the facility is genuinely pre-operational
  // (no reactor yet). Later Setup steps — registry (platform-admin gated and
  // legitimately skippable), supplier, first runs — can stay open for a long
  // time on a producing facility, and a Member must not be locked out of the
  // dashboard for them.
  if (!status.isOwnerOrAdmin) {
    const operational = (status.facility?.reactorCount ?? 0) > 0;
    return operational ? "none" : "takeover-member";
  }

  return collapsed ? "strip" : "takeover-guide";
}
