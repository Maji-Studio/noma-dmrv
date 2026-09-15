"use client";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Card } from "@/components/ui/card";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type {
  OutputStockAllocationView,
  AffectedStockPreview as Preview,
  OutputStockBalanceView,
} from "@/types/output-stock";
import { useState, type ReactNode } from "react";

const PERCENT_SCALE = 100;
const EMPTY_SCALE_KG = 1;
const BATCH_COLORS = ["var(--acc-prod)", "var(--acc-infra)", "var(--acc-dist)"];

export function OutputStockAllocations({ allocations }: { allocations: OutputStockAllocationView[] }) {
  return (
    <div className="space-y-8" aria-label="Batch breakdown">
      <h4 className="body-small font-semibold">Batch breakdown</h4>
      {allocations.length === 0 && <p className="body-caption">No dry biochar removed.</p>}
      {allocations.map((allocation) => (
        <div key={allocation.layerId} className="border border-[var(--color-border-tertiary)] p-12 space-y-4">
          <p className="body-small">{allocation.code}: {formatMassKg(allocation.dryMassKg)} dry biochar</p>
          {allocation.runs.map((run) => (
            <p key={run.productionRunId} className="body-caption text-[var(--color-text-secondary)]">
              Source run {run.code}: {formatMassKg(run.dryMassKg)} dry biochar
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function BatchBalanceBar({
  allocations,
  scale,
  wetBasis,
  colors,
  stage,
  dryLabel,
}: {
  allocations: OutputStockBalanceView[];
  scale: number;
  wetBasis: boolean;
  colors: Map<string, string>;
  stage: string;
  dryLabel: string;
}) {
  return (
    <div className="space-y-8" aria-label={`${stage} batch balances`}>
      <div className="flex h-10 w-full overflow-hidden bg-[var(--color-background-medium)]" aria-hidden="true">
        {allocations.map((allocation) => {
          const mass = wetBasis ? allocation.wetMassKg : allocation.dryMassKg;
          return (
            <span
              key={allocation.layerId}
              data-stock-batch={allocation.layerId}
              style={{
                width: `${Math.max(0, (mass ?? 0) / scale * PERCENT_SCALE)}%`,
                backgroundColor: colors.get(allocation.layerId),
              }}
            />
          );
        })}
      </div>
      <ul className="space-y-4">
        {allocations.map((allocation) => (
          <li key={allocation.layerId} className="flex items-start gap-6 body-caption">
            <span className="size-8 mt-4 shrink-0" aria-hidden="true" style={{ backgroundColor: colors.get(allocation.layerId) }} />
            <span>{allocation.code}: {formatMassKg(allocation.dryMassKg)} {dryLabel}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Read-only balance shared by posting previews and order availability. */
export function OutputStockBalanceCard({ preview, balance, scale, wetBasis = false, colors, moreInfo }: {
  preview: Pick<Preview, "binName" | "binCode" | "formulationName" | "lane" | "dryLabel" | "wetLabel" | "estimateMoisturePercent">;
  balance: { label: string; wet: number | null; dry: number | null; allocations?: OutputStockBalanceView[] };
  scale: number;
  wetBasis?: boolean;
  colors?: Map<string, string>;
  moreInfo?: ReactNode;
}) {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const binType = preview.lane === "product" ? "Product bin" : preview.lane === "ingredient" ? "Ingredient bin" : "Biochar bin";
  const batchColors = colors ?? new Map((balance.allocations ?? []).map((layer, index) => [layer.layerId, BATCH_COLORS[index % BATCH_COLORS.length]]));
  return (
    <Card.Root role="article" className="flex-row min-w-0">
      <div
        className="relative w-10 shrink-0 bg-[var(--color-background-medium)]"
        role="meter"
        aria-label={`${balance.label} stock on common scale`}
        aria-valuemin={0}
        aria-valuemax={scale}
        aria-valuenow={wetBasis ? balance.wet! : balance.dry ?? 0}
      >
        <div className="absolute inset-x-0 bottom-0 bg-[var(--acc-prod)]" style={{ height: `${Math.max(0, (wetBasis ? balance.wet! : balance.dry ?? 0) / scale * PERCENT_SCALE)}%` }} />
      </div>
      <div className="min-w-0 flex-1 p-12 space-y-8">
        <div className="space-y-4">
          <p className="label-micro">{balance.label}</p>
          <h4 className="body-small font-semibold">{preview.binName}</h4>
          <p className="body-caption">{preview.binCode ? `${preview.binCode} · ` : ""}{preview.formulationName ?? binType}</p>
        </div>
        <div className="space-y-4">
          {wetBasis && <p className="body-medium">{formatMassKg(balance.wet)} {preview.wetLabel ?? "wet estimate"}</p>}
          <p className={wetBasis ? "body-caption" : "body-medium"}>{formatMassKg(balance.dry)} {dryLabel}</p>
          {wetBasis && !preview.wetLabel && <p className="body-caption">At {formatMoisturePercent(preview.estimateMoisturePercent)} moisture</p>}
        </div>
        {balance.allocations && <BatchBalanceBar allocations={balance.allocations} scale={scale} wetBasis={wetBasis} colors={batchColors} stage={balance.label} dryLabel={dryLabel} />}
        {moreInfo}
      </div>
    </Card.Root>
  );
}

export function OutputStockPreview({ preview, moreInfo, commonScale, renderBlocker }: { preview: Preview; moreInfo?: ReactNode; commonScale?: number; renderBlocker?: (blocker: NonNullable<Preview["blockers"]>[number]) => ReactNode }) {
  const wetBasis = preview.beforeEstimatedWetKg !== null && preview.afterEstimatedWetKg !== null;
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const scale = commonScale ?? Math.max(
    wetBasis ? preview.beforeEstimatedWetKg! : preview.beforeDryKg ?? 0,
    wetBasis ? preview.afterEstimatedWetKg! : preview.afterDryKg ?? 0,
    EMPTY_SCALE_KG,
  );
  const layers = [...new Map([...(preview.beforeAllocations ?? []), ...(preview.afterAllocations ?? [])].map(layer => [layer.layerId, layer])).values()];
  const colors = new Map(layers.map((layer, index) => [layer.layerId, BATCH_COLORS[index % BATCH_COLORS.length]]));
  const balances = [
    { label: "Before loading", wet: preview.beforeEstimatedWetKg, dry: preview.beforeDryKg, allocations: preview.beforeAllocations },
    { label: "After loading", wet: preview.afterEstimatedWetKg, dry: preview.afterDryKg, allocations: preview.afterAllocations },
  ];

  return (
    <section className="space-y-16" aria-label="Stock preview" aria-live="polite">
      <div>
        {preview.removedWetKg !== null && <p className="body-large font-semibold">{formatMassKg(Math.abs(preview.removedWetKg))} wet {preview.removedWetKg < 0 ? "added" : "removed"}</p>}
        <p className={preview.removedWetKg === null ? "body-large font-semibold" : "body-caption text-[var(--color-text-secondary)]"}>
          {formatMassKg(preview.removedDryKg === null ? null : Math.abs(preview.removedDryKg))} {dryLabel} {preview.removedDryKg !== null && preview.removedDryKg < 0 ? "added" : "removed"}
        </p>
      </div>
      <p className="body-caption">
        {preview.wetLabel ? "Recorded wet stock. " : wetBasis ? `Wet estimates at ${formatMoisturePercent(preview.estimateMoisturePercent)} moisture. ` : "No moisture measurement was entered. "}
        Both bars use the same {formatMassKg(scale)} {preview.wetLabel ?? (wetBasis ? "wet estimate" : dryLabel)} scale.
        {preview.wetLabel ? " Dry solids use the recorded intake basis." : wetBasis ? " These estimates do not replace recorded pile measurements." : " Wet estimates need a moisture measurement."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
        {balances.map((balance) => (
          <OutputStockBalanceCard key={balance.label} preview={preview} balance={balance} scale={scale} wetBasis={wetBasis} colors={colors} moreInfo={moreInfo ?? (preview.lane === "ingredient" ? <IngredientStockInfo preview={preview} /> : null)} />
        ))}
      </div>
      {preview.discrepancySolidsKg > 0 && <p role="status" className="body-small">Count exceeds tracked solids by {formatMassKg(preview.discrepancySolidsKg)}. This discrepancy adds no stock.</p>}
      {preview.blockingMessage && <p role="alert" className="body-small text-[var(--st-bad)]">{preview.blockingMessage}</p>}
      {preview.blockers?.map(blocker => renderBlocker?.(blocker) ?? (blocker.entity === "binMovement" ? <span key={blocker.id}>{blocker.code}</span> : <a key={`${blocker.entity}:${blocker.id}`} className="body-small underline" href={blocker.entity === "binMovement" ? `/storage-locations?storageLocation=${preview.storageLocationId}&movement=${blocker.id}` : blocker.entity === "application" ? `/applications?ids=${blocker.id}` : blocker.entity === "ghgStatement" ? `/certification/ghg-statements?statement=${blocker.id}` : `/certification/removals?removal=${blocker.id}`}>{blocker.code}</a>))}
      <div className="space-y-8">
        <h3 className="body-small font-semibold">{preview.binName}{preview.binCode ? ` (${preview.binCode})` : ""}</h3>
        {preview.lane !== "ingredient" && <OutputStockAllocations allocations={preview.allocations} />}
      </div>
    </section>
  );
}

function IngredientStockInfo({ preview }: { preview: Preview }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)}>More info</Button>
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Ingredient stock basis">
      <div className="space-y-16">
        <h3 className="title-heading-3">{preview.binName}</h3>
        <p className="body-small">Wet stock is the recorded intake less tracked withdrawals. Ingredient withdrawals take a proportional share of this stock.</p>
        <p className="body-small">Dry solids use the recorded intake basis. The moisture used for the new product describes its ingredient addition and does not update the remaining bin.</p>
        <p className="body-small">Before: {formatMassKg(preview.beforeEstimatedWetKg)} wet stock, {formatMassKg(preview.beforeDryKg)} dry solids. After: {formatMassKg(preview.afterEstimatedWetKg)} wet stock, {formatMassKg(preview.afterDryKg)} dry solids.</p>
      </div>
    </Modal>
  </>;
}
