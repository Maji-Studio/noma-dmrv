"use client";
import { useSimplePresence } from "@/components/forms/form-detail-context";
import { OutputStockAvailability } from "@/components/storage-locations/output-stock-preview";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockPreview } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";

/**
 * Matching stock is context for an order, not one of its fields, so Simple
 * hides the block and Detailed shows it.
 */
export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const parts = useSimplePresence("hidden");
  const bins = useMatchingOutputBins(facilityId, formulationId);
  const { facilities } = useFacilityContext();
  const timezone = facilities.find(facility => facility.id === facilityId)?.timezone;
  const physicalDate = timezone ? formatFacilityDate(new Date(), timezone) : null;
  if (!formulationId) return null;
  return <section hidden={!parts.block} className="space-y-12" aria-label="Matching storage bins">
    <p className="body-small">Orders do not reserve stock. Choose the actual source bin when recording the completed delivery.</p>
    {bins.isLoading && <p role="status">Loading matching bins...</p>}
    {bins.error && <p role="alert">{bins.error.message}</p>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-24 gap-y-16">
      {bins.data?.map(bin => <MatchingOutputBinCard key={bin.id} bin={bin} facilityId={facilityId} physicalDate={physicalDate} />)}
    </div>
  </section>;
}


function MatchingOutputBinCard({ bin, facilityId, physicalDate }: {
  bin: MatchingOutputBin;
  facilityId: string;
  physicalDate: string | null;
}) {
  // A zero count reads the existing balance; its proposed after state is not an order operation.
  const stock = useOutputStockPreview(physicalDate ? {
    storageLocationId: bin.id, facilityId, physicalDate, kind: "count", wetMassKg: 0, moisturePercent: null,
  } : null);
  const preview = stock.data;
  // The hairline is the only frame: flat blocks in a two-column grid need one
  // structural line to read as separate bins.
  return <div role="article" className="space-y-8 border-t border-[var(--color-border-tertiary)] pt-12">
    <OutputStockAvailability
      binName={preview?.binName ?? bin.name}
      binCode={preview?.binCode ?? bin.code}
      subtitle={preview?.formulationName ?? "Product bin"}
      label="Available dry stock"
      dryKg={preview?.beforeDryKg ?? bin.dryMassKg}
      allocations={preview?.beforeAllocations}
      actions={<OutputStockHistory storageLocationId={bin.id} facilityId={facilityId} />}
    />
    {(stock.isLoading || !physicalDate) && <p role="status">Loading stock details...</p>}
    {stock.error && <p role="status">Stock details could not be loaded. You can still save this order.</p>}
    <p className="body-caption">Wet availability depends on measured departure moisture.</p>
  </div>;
}
