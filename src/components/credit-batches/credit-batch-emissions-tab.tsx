"use client";

import { CreditBatchEmissionsPanel } from "./credit-batch-emissions-panel";
import { cn } from "@/lib/utils";
import { PAGE_PANEL } from "./credit-batch-page-parts";

export interface CreditBatchEmissionsTabProps {
  creditBatchId: string;
  facilityId: string;
}

export function CreditBatchEmissionsTab({ creditBatchId, facilityId }: CreditBatchEmissionsTabProps) {
  return (
    // Same inner padding as the sibling tab panels; the panel's own top rule is dropped inside it.
    <div className={cn(PAGE_PANEL, "p-16 sm:p-24 [&>section]:border-t-0 [&>section]:pt-0")}>
      <CreditBatchEmissionsPanel creditBatchId={creditBatchId} facilityId={facilityId} />
    </div>
  );
}
