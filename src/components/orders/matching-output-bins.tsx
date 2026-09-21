"use client";

import { useId, useState } from "react";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { Button } from "@/components/ui/button";
import { InfoHint } from "@/components/ui/tooltip";
import { formatMassKg, formatPercent } from "@/lib/format-utils";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { useFacilityContext } from "@/hooks/use-facility-context";
import { formatFacilityDate } from "@/lib/date-utils";
import type { MatchingOutputBin } from "@/types/output-stock";
import { EmptyState } from "@/components/ui/empty-state";
import { useMatchingOutputBins, useOutputStockPreview } from "@/hooks/use-output-stock";
import { PackageIcon } from "@phosphor-icons/react/dist/ssr";

const PERCENT_SCALE = 100;

export function MatchingOutputBins({ facilityId, formulationId }: { facilityId: string; formulationId: string }) {
  const bins = useMatchingOutputBins(facilityId, formulationId);
  const { facilities } = useFacilityContext();
  const timezone = facilities.find(facility => facility.id === facilityId)?.timezone;
  const physicalDate = timezone ? formatFacilityDate(new Date(), timezone) : null;
  if (!formulationId) return null;
  return <section className="space-y-16 bg-[var(--color-surface-light)] p-16" aria-label="Matching storage bins">
    <p className="body-small">Orders do not reserve stock. Choose the actual source bin when recording the completed delivery.</p>
    {bins.isLoading && <p role="status">Loading matching bins...</p>}
    {bins.error && <p role="alert">{bins.error.message}</p>}
    {bins.data?.length === 0 && <EmptyState icon={<PackageIcon size={32} />} title="No matching stock" description="You can save this order now and record its delivery when stock is available." padding="sm" />}
    <div className="space-y-16">
      {bins.data?.map(bin => <MatchingOutputBinCard key={bin.id} bin={bin} facilityId={facilityId} physicalDate={physicalDate} />)}
    </div>
  </section>;
}


function MatchingOutputBinCard({ bin, facilityId, physicalDate }: {
  bin: MatchingOutputBin;
  facilityId: string;
  physicalDate: string | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();
  // A zero count reads the existing balance; its proposed after state is not an order operation.
  const stock = useOutputStockPreview(physicalDate ? {
    storageLocationId: bin.id, facilityId, physicalDate, kind: "count", wetMassKg: 0, moisturePercent: null,
  } : null);
  const preview = stock.data;
  const total = preview?.beforeDryKg ?? bin.dryMassKg;
  return <div className="space-y-12">
    <div className="flex items-center justify-between gap-12">
      <div className="min-w-0 space-y-4"><h3 className="body-small font-medium">{bin.name}</h3><p className="body-caption tabular-nums">{formatMassKg(total)} dry biochar</p></div>
      <Button type="button" variant="noOutline" className="min-h-44 shrink-0 px-8" aria-expanded={detailsOpen} aria-controls={detailsId} aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${bin.name}`} onClick={() => setDetailsOpen(!detailsOpen)}>{detailsOpen ? "Hide details" : "Details"}</Button>
    </div>
    <table className="w-full table-fixed body-caption">
      <caption className="sr-only">{bin.name} available dry biochar by blend or lot</caption>
      <thead><tr className="border-b border-[var(--color-border-secondary)]"><th scope="col" className="w-1/2 pb-8 text-left font-normal">Blend / lot</th><th scope="col" className="pb-8 text-right font-normal">Dry biochar</th><th scope="col" className="pb-8 text-right font-normal">% of total</th></tr></thead>
      <tbody>{preview?.beforeAllocations?.map(lot => <tr key={lot.layerId}><th scope="row" className="space-y-4 py-8 pr-12 text-left font-normal">{lot.code}<div aria-hidden="true" className="h-8 bg-[var(--color-background-medium)]"><div className="h-full bg-[var(--clr-dark-purple-80)]" style={{ width: `${total > 0 && lot.dryMassKg !== null ? lot.dryMassKg / total * PERCENT_SCALE : 0}%` }} /></div></th><td className="py-8 text-right align-top tabular-nums">{formatMassKg(lot.dryMassKg)}</td><td className="py-8 text-right align-top tabular-nums">{total > 0 && lot.dryMassKg !== null ? formatPercent(lot.dryMassKg / total * PERCENT_SCALE) : MISSING_VALUE.notAvailable}</td></tr>)}</tbody>
    </table>
    <div id={detailsId} hidden={!detailsOpen} className="space-y-12 border-t border-[var(--color-border-secondary)] pt-16 body-caption">
      <p>{bin.code}{preview?.formulationName ? ` · ${preview.formulationName}` : ""}</p>
      <div className="flex items-center gap-8">FIFO: oldest eligible first<InfoHint label="About FIFO">At delivery, stock placed by the movement date is used oldest first, then by posting order. Creating an order does not draw from these lots.</InfoHint></div>
      <p>Available dry biochar is the sum of the remaining source lots. It excludes ingredient solids and water.</p>
      <p>Wet availability depends on measured departure moisture.</p>
      {preview?.beforeAllocations?.map(lot => <div key={lot.layerId} className="space-y-4 border-l-2 border-[var(--color-border-secondary)] pl-12"><p className="font-medium">{lot.code}</p>{lot.runs.map(run => <p key={run.productionRunId}>{run.code}: {formatMassKg(run.dryMassKg)} dry biochar</p>)}</div>)}
      <OutputStockHistory storageLocationId={bin.id} facilityId={facilityId} />
    </div>
    {(stock.isLoading || !physicalDate) && <p role="status">Loading stock details...</p>}
    {stock.error && <p role="status">Stock details could not be loaded. You can still save this order.</p>}
  </div>;
}
