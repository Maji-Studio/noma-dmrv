"use client";

/** The Production, Samples and Activities tabs of the credit batch page. */
import Link from "next/link";
import { FactoryIcon } from "@phosphor-icons/react/dist/ssr";
import { CreditBatchActivityView } from "@/components/activity";
import { EmptyState } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/loading-skeleton";
import { Notice } from "@/components/ui/notice";
import { useCreditBatchProductionRunOptions } from "@/hooks/use-credit-batches";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { productionRunDeepLinkHref } from "@/lib/certification/links";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatTonnes } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { computeCohortInputTotals } from "./cohort-input-ledger";
import { CreditBatchDurabilityPanel } from "./credit-batch-durability-panel";
import { useCreditBatchPage } from "./credit-batch-page-context";
import { FOCUS_RING, MUTED_TEXT, PAGE_PANEL, PagePanel } from "./credit-batch-page-parts";

const SKELETON_ROWS = 3;
const SKELETON_ROW_HEIGHT_PX = 40;
const HEADER_CELL = "py-8 body-small font-medium text-[var(--color-text-secondary)]";

function tonnesOrMissing(kg: number | null): string {
  return kg == null ? MISSING_VALUE.notRecorded : formatTonnes(kgToTonnes(kg));
}

/** One run table: feedstock dry mass and dry biochar per member run, with a total row. */
export function CreditBatchProductionTab() {
  const { batch } = useCreditBatchPage();
  const runsQuery = useCreditBatchProductionRunOptions({
    facilityId: batch.facilityId,
    startDate: batch.startDate,
    endDate: batch.endDate,
    includeCreditBatchId: batch.id,
  });
  const memberIds = new Set(batch.productionRunIds);
  const runs = (runsQuery.data ?? []).filter((run) => memberIds.has(run.id));
  const totals = computeCohortInputTotals(runs);

  let body;
  if (runsQuery.error) {
    body = (
      <Notice
        tone="warning"
        action={<Button variant="weak" size="small" busy={runsQuery.isFetching} onClick={() => void runsQuery.refetch()}>Retry</Button>}
      >
        Production runs could not be loaded. Retry to load them.
      </Notice>
    );
  } else if (runsQuery.isLoading) {
    body = (
      <div className="flex flex-col gap-8" aria-busy>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => <Skeleton key={index} height={SKELETON_ROW_HEIGHT_PX} />)}
      </div>
    );
  } else if (runs.length === 0) {
    body = (
      <EmptyState
        padding="sm"
        icon={<FactoryIcon size={32} />}
        title="No production runs in this credit batch"
        description="Completed runs of this feedstock type inside the batch window join it when the batch is saved."
      />
    );
  } else {
    body = (
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-[var(--color-border-secondary)] text-left">
            <th scope="col" className={HEADER_CELL}>Production run</th>
            <th scope="col" className={cn(HEADER_CELL, "pl-12 text-right")}>Feedstock dry mass</th>
            <th scope="col" className={cn(HEADER_CELL, "pl-12 text-right")}>Dry biochar</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-t border-[var(--color-border-tertiary)] first:border-t-0">
              <td className="py-10">
                <Link
                  href={productionRunDeepLinkHref(run.id, batch.facilityId)}
                  className={cn("group flex min-h-44 min-w-0 flex-col justify-center", FOCUS_RING)}
                >
                  <span className="body-medium font-medium underline-offset-2 group-hover:underline">{run.code}</span>
                  <span className={cn("body-caption", MUTED_TEXT)}>
                    {formatDate(run.date)}
                    {run.biocharStorageName ? `, ${run.biocharStorageName}` : ""}
                  </span>
                </Link>
              </td>
              <td className="py-10 pl-12 text-right body-small tabular-nums">{tonnesOrMissing(run.feedstockMassDryKg)}</td>
              <td className="py-10 pl-12 text-right body-small tabular-nums">{tonnesOrMissing(run.biocharDryMassKg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--color-border-secondary)]">
            <th scope="row" className="py-10 text-left body-medium font-medium">Total</th>
            <td className="py-10 pl-12 text-right body-medium font-medium tabular-nums">{tonnesOrMissing(totals.feedstockDryKg)}</td>
            <td className="py-10 pl-12 text-right body-medium font-medium tabular-nums">{tonnesOrMissing(totals.dryOutputKg)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  return (
    <PagePanel
      title="Production runs"
      labelledBy="credit-batch-production-runs"
      action={<span className={cn("body-small", MUTED_TEXT)}>{batch.productionRunCount} in this credit batch</span>}
    >
      {body}
    </PagePanel>
  );
}

/** The existing durability panel; it brings its own heading and its one "Record another Sample" action. */
export function CreditBatchSamplesTab() {
  const { batch, focus } = useCreditBatchPage();
  return (
    <div className={cn(PAGE_PANEL, "p-16 sm:p-24 [&>section]:border-t-0 [&>section]:pt-0")}>
      <CreditBatchDurabilityPanel creditBatchId={batch.id} facilityId={batch.facilityId} focusedSampleId={focus} />
    </div>
  );
}

export function CreditBatchActivitiesTab() {
  const { batch } = useCreditBatchPage();
  return <CreditBatchActivityView creditBatchId={batch.id} batchCode={batch.code} inline />;
}
