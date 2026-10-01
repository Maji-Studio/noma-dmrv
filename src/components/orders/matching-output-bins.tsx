"use client";
import { useSimplePresence } from "@/components/forms/form-detail-context";
import { OutputStockAvailability } from "@/components/storage-locations/output-stock-preview";
import { StockNotice } from "@/components/storage-locations/stock-figures";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockBalance } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";

/** Status lines under a block: caption size, secondary ink. */
const STATUS_CLASS = "body-caption text-[var(--color-text-secondary)]";

/**
 * Matching stock is context for an order, not one of its fields, so Simple
 * hides the block and Detailed shows it.
 *
 * Each bin leads with its wet stock. An order has no departure moisture yet
 * (the delivery measures it), so the estimate uses each batch's latest
 * moisture reading; a bin whose layers do not resolve falls back to its dry stock.
 * Simple renders nothing here, so it does not fetch the bins either.
 */
export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const parts = useSimplePresence("hidden");
  const bins = useMatchingOutputBins(facilityId, formulationId, parts.block);
  if (!formulationId) return null;
  return <section hidden={!parts.block} className="flex flex-col gap-16" aria-label="Matching storage bins">
    {bins.isLoading && <p role="status" className={STATUS_CLASS}>Loading matching bins</p>}
    {bins.error && <StockNotice tone="error" role="alert">{bins.error.message}</StockNotice>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    {bins.data && bins.data.length > 0 && <div className="flex flex-col gap-20">
      {bins.data.map(bin => <MatchingOutputBinCard key={bin.id} bin={bin} facilityId={facilityId} />)}
    </div>}
  </section>;
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
    />
    {stock.isLoading && <p role="status" className={STATUS_CLASS}>Loading stock details</p>}
    {stock.error && <p role="status" className={STATUS_CLASS}>Stock details could not be loaded. You can still save this order.</p>}
  </div>;
}
