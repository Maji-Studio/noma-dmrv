"use client";

import { CompositionCard } from "@/components/forms/composition-card";
import { CompositionLedger } from "@/components/forms/composition-ledger";
import { InfoHint } from "@/components/ui/tooltip";
import { formatMassKg } from "@/lib/format-utils";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockPreview } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";


export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const bins = useMatchingOutputBins(facilityId, formulationId);
  const { facilities } = useFacilityContext();
  const timezone = facilities.find(facility => facility.id === facilityId)?.timezone;
  const physicalDate = timezone ? formatFacilityDate(new Date(), timezone) : null;
  if (!formulationId) return null;
  return <section className="space-y-16" aria-label="Matching storage bins">
    {bins.isLoading && <p role="status">Loading matching bins...</p>}
    {bins.error && <p role="alert">{bins.error.message}</p>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    <div className="space-y-16">
      {bins.data?.map(bin => <MatchingOutputBinCard key={bin.id} bin={bin} facilityId={facilityId} physicalDate={physicalDate} />)}
    </div>
    <p className="body-caption text-[var(--color-text-secondary)]">Orders do not reserve stock. The source bin is chosen when the delivery is recorded.</p>
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
  const total = preview?.beforeDryKg ?? bin.dryMassKg;
  return <CompositionCard title={bin.name} details={<div className="space-y-12 body-small">
    <p>{bin.code}{preview?.formulationName ? ` (${preview.formulationName})` : ""}</p>
    <div className="flex items-center gap-8">FIFO: oldest eligible first<InfoHint label="About FIFO">At delivery, stock placed by the movement date is used oldest first, then by posting order. Dry biochar excludes ingredient solids and water. Creating an order does not draw from these lots.</InfoHint></div>
    <p>Available dry biochar is the sum of the remaining lots. Wet availability depends on measured departure moisture.</p>
    {preview?.beforeAllocations?.map(lot => <div key={lot.layerId} className="space-y-4 border-l-2 border-[var(--color-border-secondary)] pl-12"><p className="font-medium">{lot.code}: {formatMassKg(lot.dryMassKg)} dry biochar</p>{lot.runs.map(run => <p key={run.productionRunId}>{run.code}: {formatMassKg(run.dryMassKg)} dry biochar</p>)}</div>)}
    <OutputStockHistory storageLocationId={bin.id} facilityId={facilityId} triggerLabel="View source lots" />
  </div>}>
    <CompositionLedger label={`${bin.name} available dry biochar by blend or lot`} totalLabel="Dry biochar in this bin" total={total} segments={(preview?.beforeAllocations ?? []).map(lot => ({ label: lot.code, mass: lot.dryMassKg, category: "dry-batch" }))} />
    {(stock.isLoading || !physicalDate) && <p role="status">Loading stock details...</p>}
    {stock.error && <p role="status">Stock details could not be loaded. You can still save this order.</p>}
  </CompositionCard>;
}
