/**
 * useSetupSteps — pure derivation of the Setup steps' done-ness from the
 * onboarding status. No stored per-step flags: each step is done iff the
 * corresponding record exists, so the guide can never drift from reality and
 * self-clears once the last step is satisfied.
 */

import type { OnboardingStatus } from "@/data-access/onboarding";
import {
  SETUP_STEPS,
  SETUP_STEP_COUNT,
  buildStepHref,
  type SetupStepMeta,
} from "./onboarding-constants";

export interface SetupStep extends SetupStepMeta {
  done: boolean;
  /** Deep-link that opens this step's create surface. */
  href: string;
}

export interface SetupProgress {
  steps: SetupStep[];
  doneCount: number;
  total: number;
  allComplete: boolean;
  /**
   * True once every non-skippable (required) step is done — the facility is
   * operational even if an optional step (the registry link) is still open.
   * Drives the Owner/Admin dashboard gate so an intentionally-unconnected
   * registry doesn't pin the guide open forever.
   */
  requiredComplete: boolean;
  /** Index of the first not-done step — the single actionable one. `-1` when complete. */
  activeIndex: number;
}

function isStepDone(
  id: SetupStepMeta["id"],
  status: OnboardingStatus,
): boolean {
  const facility = status.facility;
  switch (id) {
    case "facility":
      return status.facilityCount > 0;
    case "supplier":
      return status.supplierCount > 0;
    case "reactor":
      return (facility?.reactorCount ?? 0) > 0;
    case "registry":
      return facility?.registryConnected ?? false;
    case "feedstock":
      return (facility?.feedstockCount ?? 0) > 0;
    case "production":
      return (facility?.completeProductionRunCount ?? 0) > 0;
    case "credit":
      return (facility?.creditBatchCount ?? 0) > 0;
  }
}

export function deriveSetupProgress(
  status: OnboardingStatus | undefined,
  facilityId: string | null,
): SetupProgress {
  const steps: SetupStep[] = SETUP_STEPS.map((meta) => ({
    ...meta,
    done: status ? isStepDone(meta.id, status) : false,
    href: buildStepHref(meta.id, facilityId),
  }));

  const doneCount = steps.filter((step) => step.done).length;
  const activeIndex = steps.findIndex((step) => !step.done);

  return {
    steps,
    doneCount,
    total: SETUP_STEP_COUNT,
    allComplete: doneCount === SETUP_STEP_COUNT,
    requiredComplete: steps.every((step) => step.skippable || step.done),
    activeIndex,
  };
}
