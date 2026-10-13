"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { SetupActions } from "./setup-actions";
import type { SetupStep } from "./use-setup-steps";

export function SetupStepAction({
  step,
  active,
  actions,
}: {
  step: SetupStep;
  active: boolean;
  actions: SetupActions;
}) {
  const router = useRouter();
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
      disabled={needsFacility && !actions.facilityId}
      onClick={() => {
        if (step.id in open) open[step.id as keyof typeof open]();
        else router.push(step.href);
      }}
    >
      {step.ctaLabel}
    </Button>
  );
}
