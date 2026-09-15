"use client";
import { OutputStockBalanceCard } from "@/components/storage-locations/output-stock-preview";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockPreview } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";

const EMPTY_SCALE_KG = 1;

export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const bins = useMatchingOutputBins(facilityId, formulationId);
  const { facilities } = useFacilityContext();
  const timezone = facilities.find(facility => facility.id === facilityId)?.timezone;
  const physicalDate = timezone ? formatFacilityDate(new Date(), timezone) : null;
  if (!formulationId) return null;
  return <section className="space-y-12" aria-label="Matching storage bins">
    <p className="body-small">Orders do not reserve stock. Choose the actual source bin when recording the completed delivery.</p>
    {bins.isLoading && <p role="status">Loading matching bins...</p>}
    {bins.error && <p role="alert">{bins.error.message}</p>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-12">
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
  return <div className="space-y-8">
    <OutputStockBalanceCard
      preview={preview ?? { binName: bin.name, binCode: bin.code, lane: "product", estimateMoisturePercent: null }}
      balance={{ label: "Available dry stock", wet: null, dry: preview?.beforeDryKg ?? bin.dryMassKg, allocations: preview?.beforeAllocations }}
      scale={Math.max(preview?.beforeDryKg ?? bin.dryMassKg, EMPTY_SCALE_KG)}
      moreInfo={<OutputStockHistory storageLocationId={bin.id} facilityId={facilityId} />}
    />
    {(stock.isLoading || !physicalDate) && <p role="status">Loading stock details...</p>}
    {stock.error && <p role="status">Stock details could not be loaded. You can still save this order.</p>}
    <p className="body-caption">Wet availability depends on measured departure moisture.</p>
  </div>;
}
