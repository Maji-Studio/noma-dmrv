"use client";
import { useId, useState } from "react";
import { CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui";
import { pluralize } from "@/lib/copy-utils";
import { formatMassKg } from "@/lib/format-utils";
import { DerivedHeadline } from "@/components/forms";
import { formatWetEstimate } from "@/components/storage-locations/stock-preview-shared";
import { OutputStockAvailability } from "@/components/storage-locations/output-stock-preview";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockBalance } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";
import { Notice } from "@/components/ui/notice";

/** Status lines under a block: caption size, secondary ink. */
const STATUS_CLASS = "body-caption text-[var(--color-text-secondary)]";

/**
 * The row's figures. Wet leads, as an estimate, and counts only the bins that
 * have one; dry gets the same honesty. A partial sum is never presented as the
 * total, the headline never switches to dry, and an unresolved figure is null
 * so the muted "Not available" applies.
 */
export function summarizeMatchingStock(bins: readonly MatchingOutputBin[]): { wet: string | null; dry: string | null; binCount: number } {
  const binCount = bins.length;
  const withWet = bins.filter(bin => bin.estimatedWetMassKg != null);
  const withDry = bins.filter(bin => bin.dryMassKg != null);
  const wetKg = withWet.reduce((sum, bin) => sum + (bin.estimatedWetMassKg ?? 0), 0);
  const dryKg = withDry.reduce((sum, bin) => sum + (bin.dryMassKg ?? 0), 0);
  const coverage = (known: number) => known === binCount ? "" : ` in ${known} of ${binCount} bins`;
  return {
    wet: withWet.length === 0 ? null : `≈ ${formatWetEstimate(wetKg)} kg wet${coverage(withWet.length)}`,
    dry: withDry.length === 0 ? null : `${formatMassKg(dryKg)}${coverage(withDry.length)}`,
    binCount,
  };
}

/**
 * Matching stock informs the order, so both levels show it: one total, and
 * the single bins behind it in a modal (the same in Simple and Detailed).
 *
 * Each bin leads with its wet stock. An order has no departure moisture yet
 * (the delivery measures it), so the estimate uses each batch's latest
 * moisture reading; a bin whose layers do not resolve falls back to its dry stock.
 */
export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const bins = useMatchingOutputBins(facilityId, formulationId);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  if (!formulationId) return null;
  const summary = bins.data && bins.data.length > 0 ? summarizeMatchingStock(bins.data) : null;
  return <section className="flex flex-col gap-16" aria-label="Matching storage bins">
    {bins.isLoading && <p role="status" className={STATUS_CLASS}>Loading matching bins</p>}
    {bins.error && <Notice tone="error">{bins.error.message}</Notice>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    {bins.data && summary && <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full items-center justify-between gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-10 text-left transition-colors duration-300 hover:border-[var(--color-border-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-interaction)]"
      >
        <DerivedHeadline
          label="Available wet stock, estimate"
          value={summary.wet}
          secondary={{ label: "Available dry stock", value: summary.dry }}
          sub={`${summary.binCount} ${pluralize(summary.binCount, "bin", "bins")}`}
        />
        <CaretRightIcon aria-hidden size={16} weight="bold" className="shrink-0 text-[var(--color-text-tertiary)]" />
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabelledBy={titleId} width="md">
        <div className="flex flex-col gap-20" data-testid="matching-stock-dialog">
          <h2 id={titleId} className="title-heading-3">Matching stock</h2>
          <MatchingOutputBinList bins={bins.data} facilityId={facilityId} />
        </div>
      </Modal>
    </>}
  </section>;
}

/** The single bins, one existing availability card each. */
export function MatchingOutputBinList({ bins, facilityId }: { bins: readonly MatchingOutputBin[]; facilityId: string }) {
  return <div className="flex flex-col gap-20">
    {bins.map(bin => <MatchingOutputBinCard key={bin.id} bin={bin} facilityId={facilityId} />)}
  </div>;
}


function MatchingOutputBinCard({ bin, facilityId }: {
  bin: MatchingOutputBin;
  facilityId: string;
}) {
  // A zero count reads the existing balance; its proposed after state is not an order operation.
  const stock = useOutputStockBalance({ storageLocationId: bin.id, facilityId });
  const preview = stock.data;
  return <div role="article" className="flex flex-col gap-8">
    <OutputStockAvailability
      binName={preview?.binName ?? bin.name}
      dryKg={preview?.beforeDryKg ?? bin.dryMassKg}
      wetEstimate={bin.estimatedWetMassKg == null ? null : { kg: bin.estimatedWetMassKg, basis: "At the latest moisture reading of each batch" }}
      allocations={preview?.beforeAllocations}
      actions={<OutputStockHistory compact triggerLabel="Stock history" storageLocationId={bin.id} facilityId={facilityId} />}
    />
    {stock.isLoading && <p role="status" className={STATUS_CLASS}>Loading stock details</p>}
    {stock.error && <p role="status" className={STATUS_CLASS}>Stock details could not be loaded. You can still save this order.</p>}
  </div>;
}
