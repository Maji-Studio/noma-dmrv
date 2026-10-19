/**
 * SetupInProgressState — what a plain Member sees while an Owner/Admin is still
 * provisioning the facility. Calm and non-actionable: setup is not their job.
 */
"use client";

import { EmptyState } from "@/components/ui";
import { FacilityArt, ILLUSTRATION_SIZE } from "@/components/ui/illustrations";

export function SetupInProgressState() {
  return (
    <EmptyState
      icon={<FacilityArt size={ILLUSTRATION_SIZE.empty} />}
      title="Setup in progress"
      description="Your admin is still configuring this facility. It'll appear here once it's ready."
    />
  );
}
