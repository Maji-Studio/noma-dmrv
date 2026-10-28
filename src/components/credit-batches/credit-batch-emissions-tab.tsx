"use client";

/**
 * The batch page's Emissions tab: the one place a credit batch's emissions are
 * read and recorded (KPI strip, lines, manual entries, previous / next batch
 * when opened from the Emissions list).
 */
import { BatchEmissions } from "@/components/emissions/batch-emissions";
import { TemplatePermissionProvider } from "@/components/emissions/template-permission";
import { useCreditBatchPage } from "./credit-batch-page-context";

export function CreditBatchEmissionsTab() {
  const { batch, canManage } = useCreditBatchPage();
  return (
    // No tab panel frame: the counts and the component table bring their own, as Activities does.
    <div data-testid="credit-batch-emissions-tab" className="min-w-0">
      <TemplatePermissionProvider canManage={canManage}>
        <BatchEmissions
          key={batch.id}
          facilityId={batch.facilityId}
          batch={{ creditBatchId: batch.id, code: batch.code, startDate: batch.startDate, endDate: batch.endDate }}
        />
      </TemplatePermissionProvider>
    </div>
  );
}
