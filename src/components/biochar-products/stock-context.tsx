"use client";

import { BinMovementHistoryModal } from "@/components/storage-locations/bin-movement-history-modal";
import { OutputStockHistory } from "@/components/storage-locations/output-stock-history";
import { InfoHint } from "@/components/ui/tooltip";
import { formatCompositionMass as formatMassKg } from "./composition-card";
import type { AffectedStockPreview } from "@/types/output-stock";

/** Only a fresh, successful server projection can advertise a stock movement. */
export function StockChangeLabel({ name, preview, available }: { name: string; preview?: AffectedStockPreview; available: boolean }) {
  const amount = preview?.removedWetKg;
  const valid = available && !preview?.blockingMessage && typeof amount === "number" && Number.isFinite(amount) && amount !== 0;
  return <span className="flex min-w-0 items-center gap-4"><span className="truncate">{name}</span>{valid && <span className={`shrink-0 ${amount < 0 ? "text-[var(--st-ok)]" : "text-[var(--st-wait)]"}`}> ({amount < 0 ? "+" : "−"}{formatMassKg(Math.abs(amount))} wet)</span>}</span>;
}

/**
 * The dated server projection for one bin: what it holds, what this entry
 * leaves, and which lots the entry draws from. Only rendered inside Details.
 */
export function StockContext({ preview, facilityId }: { preview?: AffectedStockPreview; facilityId: string }) {
  if (!preview) return null;
  return <div className="space-y-12">
    <h4 className="body-small font-medium">{preview.binName}</h4>
    <dl className="grid grid-cols-2 gap-12 body-caption">
      <div><dt className="text-[var(--color-text-secondary)]">Available {preview.lane === "ingredient" ? "dry solids" : "dry biochar"}</dt><dd className="tabular-nums">{formatMassKg(preview.beforeDryKg)}</dd></div>
      <div><dt className="text-[var(--color-text-secondary)]">Remaining after this entry</dt><dd className="tabular-nums">{formatMassKg(preview.afterDryKg)}</dd></div>
    </dl>
    {preview.allocations.length > 0 && <div className="space-y-8 body-caption">
      {preview.removedWetKg != null && preview.removedWetKg > 0 && <div className="flex items-center gap-8 text-[var(--color-text-secondary)]">Drawn from the oldest lot first<InfoHint label="About FIFO">Available lots placed by the movement date are used oldest first, then by posting order.</InfoHint></div>}
      {preview.allocations.map(lot => <div key={lot.layerId} className="space-y-4 border-l-2 border-[var(--color-border-secondary)] pl-12">
        <div>{lot.code}: {formatMassKg(lot.dryMassKg)} dry biochar</div>
        {lot.runs.filter(run => lot.runs.length > 1 || run.code !== lot.code).map(run => <div key={run.productionRunId} className="text-[var(--color-text-secondary)]">{run.code}: {formatMassKg(run.dryMassKg)} dry biochar</div>)}
      </div>)}
    </div>}
    {preview.lane === "ingredient" ? <BinMovementHistoryModal quietTrigger storageLocationId={preview.storageLocationId} triggerLabel="View stock history" /> : <OutputStockHistory quietTrigger storageLocationId={preview.storageLocationId} facilityId={facilityId} triggerLabel="View source lots" />}
  </div>;
}
