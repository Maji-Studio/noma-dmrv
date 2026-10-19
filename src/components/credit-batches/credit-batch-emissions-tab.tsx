"use client";

/**
 * The Emissions tab of the credit batch page. With EMISSIONS_ENTRIES_ENABLED
 * it shows `CreditBatchEmissionsPanel` (#1140): the template lines still open
 * and a link to record them. Without the flag it points to the batch's
 * Emissions page, where its production inputs are listed.
 */
import Link from "next/link";
import { LightningIcon } from "@phosphor-icons/react/dist/ssr";
import { emissionsBatchHref } from "@/components/emissions/emissions-overview-query";
import { EmptyState } from "@/components/ui";
import { buttonVariants } from "@/components/ui/button";
import { CreditBatchEmissionsPanel } from "./credit-batch-emissions-panel";
import { PAGE_PANEL } from "./credit-batch-page-parts";

export interface CreditBatchEmissionsTabProps {
  creditBatchId: string;
  facilityId: string;
  /** The server's EMISSIONS_ENTRIES_ENABLED flag. */
  entriesEnabled: boolean;
}

export function CreditBatchEmissionsTab({ creditBatchId, facilityId, entriesEnabled }: CreditBatchEmissionsTabProps) {
  if (entriesEnabled) {
    return (
      <div className={PAGE_PANEL}>
        <CreditBatchEmissionsPanel creditBatchId={creditBatchId} facilityId={facilityId} enabled />
      </div>
    );
  }
  return (
    <div className={PAGE_PANEL}>
      <EmptyState
        padding="md"
        icon={<LightningIcon size={40} />}
        title="Emissions are recorded on the Emissions page"
        description="Diesel, electricity and other inputs for this credit batch come from its production runs."
        action={
          <Link href={emissionsBatchHref(creditBatchId, { facility: facilityId })} className={buttonVariants({ variant: "default" })}>
            Open emissions
          </Link>
        }
      />
    </div>
  );
}
