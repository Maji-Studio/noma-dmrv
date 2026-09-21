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

export function StockContext({ preview, facilityId }: { preview?: AffectedStockPreview; facilityId: string }) {
  if (!preview) return null;
  return <div className="space-y-12">
    <h4 className="body-small font-medium">{preview.binName}</h4>
    <dl className="grid grid-cols-2 gap-12 body-caption">
      <div><dt>Available {preview.lane === "ingredient" ? "dry solids" : "dry biochar"}</dt><dd>{formatMassKg(preview.beforeDryKg)}</dd></div>
      <div><dt>Remaining {preview.lane === "ingredient" ? "dry solids" : "dry biochar"}</dt><dd>{formatMassKg(preview.afterDryKg)}</dd></div>
    </dl>
    {preview.lane !== "ingredient" && <>
      <div className="flex items-center gap-8 body-caption">FIFO: oldest eligible first<InfoHint label="About FIFO">Available lots placed by the movement date are used oldest first, then by posting order.</InfoHint></div>
      {preview.allocations.map(lot => <div key={lot.layerId} className="space-y-4 pl-12 border-l-2 border-[var(--color-border-secondary)]"><p>{lot.code}: {formatMassKg(lot.dryMassKg)} dry biochar</p>{lot.runs.map(run => <p key={run.productionRunId} className="body-caption">{run.code}: {formatMassKg(run.dryMassKg)} dry biochar</p>)}</div>)}
      <OutputStockHistory storageLocationId={preview.storageLocationId} facilityId={facilityId} />
    </>}
    {preview.lane === "ingredient" && <><p className="body-caption">Ingredient withdrawals use a proportional share of the bin. Product moisture describes the addition and does not change remaining stock.</p><BinMovementHistoryModal storageLocationId={preview.storageLocationId} /></>}
  </div>;
}
