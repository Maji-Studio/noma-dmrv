/**
 * SetupInProgressState — what a plain Member sees while an Owner/Admin is still
 * provisioning the facility. Calm and non-actionable: setup is not their job.
 */
"use client";

import { WrenchIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";

export function SetupInProgressState() {
  return (
    <EmptyState
      icon={<WrenchIcon size={48} />}
      title="Setup in progress"
      description="Your admin is still configuring this facility. It'll appear here once it's ready."
    />
  );
}
