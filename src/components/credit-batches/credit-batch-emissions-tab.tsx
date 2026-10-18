"use client";

/**
 * The Emissions tab of the credit batch page: the one seam where
 * `CreditBatchEmissionsPanel` (#1058 PR 3) mounts behind
 * `EMISSIONS_ENTRIES_ENABLED` once it lands (docs/open-questions.md). Until
 * then the tab points to the Energy page, where production inputs are
 * recorded today.
 */
import Link from "next/link";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { PAGE_PANEL } from "./credit-batch-page-parts";

export interface CreditBatchEmissionsTabProps {
  facilityId: string;
}

export function CreditBatchEmissionsTab({ facilityId }: CreditBatchEmissionsTabProps) {
  return (
    <div className={PAGE_PANEL}>
      <EmptyState
        padding="md"
        icon={<LightningIcon size={40} />}
        title="Emissions are recorded on the Energy page"
        description="Diesel, electricity and other inputs for this credit batch come from its production runs."
        action={
          <Link href={`/energy?${new URLSearchParams({ facility: facilityId })}`} className={buttonVariants({ variant: "default" })}>
            Open Energy
          </Link>
        }
      />
    </div>
  );
}
