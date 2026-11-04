"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { SetupActions } from "./setup-actions";
import type { SetupStep } from "./use-setup-steps";

/**
 * One transition for a list of step buttons: the clicked step stays busy until
 * its page has rendered, and the other steps are disabled meanwhile.
 */
export function useStepNavigation() {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  return {
    pendingId: navigating ? pendingId : null,
    go(step: SetupStep) {
      setPendingId(step.id);
      startNavigation(() => router.push(step.href));
    },
  };
}

export function SetupStepAction({
  step,
  active,
  actions,
  navigation,
}: {
  step: SetupStep;
  active: boolean;
  actions: SetupActions;
  navigation: ReturnType<typeof useStepNavigation>;
}) {
  const open = {
    facility: actions.onOpenFacility,
    reactor: actions.onOpenReactor,
    registry: actions.onOpenRegistry,
  };
  const needsFacility = step.id === "reactor" || step.id === "registry";

  return (
    <Button
      variant={active ? "primary" : "default"}
      size="small"
      busy={navigation.pendingId === step.id}
      disabled={(needsFacility && !actions.facilityId) || (navigation.pendingId !== null && navigation.pendingId !== step.id)}
      onClick={() => {
        if (step.id in open) open[step.id as keyof typeof open]();
        else navigation.go(step);
      }}
    >
      {step.ctaLabel}
    </Button>
  );
}
