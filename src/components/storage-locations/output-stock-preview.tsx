"use client";

import { Card } from "@/components/ui/card";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type {
  OutputStockAllocationView,
  OutputStockPreview as Preview,
} from "@/types/output-stock";
import type { ReactNode } from "react";

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
}: {
  allocations: OutputStockAllocationView[];
  scale: number;
  wetBasis: boolean;
  colors: Map<string, string>;
  stage: string;
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
            <span>{allocation.code}: {formatMassKg(allocation.dryMassKg)} dry biochar</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OutputStockPreview({ preview, moreInfo }: { preview: Preview; moreInfo?: ReactNode }) {
  const wetBasis = preview.beforeEstimatedWetKg !== null && preview.afterEstimatedWetKg !== null;
  const scale = Math.max(
    wetBasis ? preview.beforeEstimatedWetKg! : preview.beforeDryKg,
    wetBasis ? preview.afterEstimatedWetKg! : preview.afterDryKg,
    EMPTY_SCALE_KG,
  );
  const layers = preview.beforeAllocations ?? preview.afterAllocations ?? [];
  const colors = new Map(layers.map((layer, index) => [layer.layerId, BATCH_COLORS[index % BATCH_COLORS.length]]));
  const balances = [
    { label: "Before loading", wet: preview.beforeEstimatedWetKg, dry: preview.beforeDryKg, allocations: preview.beforeAllocations },
    { label: "After loading", wet: preview.afterEstimatedWetKg, dry: preview.afterDryKg, allocations: preview.afterAllocations },
  ];
  const binType = preview.lane === "product" ? "Product bin" : "Biochar bin";

  return (
    <section className="space-y-16" aria-label="Stock preview" aria-live="polite">
      <div>
        {preview.removedWetKg !== null && <p className="body-large font-semibold">{formatMassKg(preview.removedWetKg)} wet removed</p>}
        <p className={preview.removedWetKg === null ? "body-large font-semibold" : "body-caption text-[var(--color-text-secondary)]"}>
          {formatMassKg(preview.removedDryKg)} dry biochar removed
        </p>
      </div>
      <p className="body-caption">
        {wetBasis ? `Wet estimates at ${formatMoisturePercent(preview.estimateMoisturePercent)} moisture. ` : "No moisture measurement was entered. "}
        Both bars use the same {formatMassKg(scale)} {wetBasis ? "wet estimate" : "dry biochar"} scale.
        {wetBasis ? " These estimates do not replace recorded pile measurements." : " Wet estimates need a moisture measurement."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
        {balances.map((balance) => (
          <Card.Root key={balance.label} className="flex-row min-w-0">
            <div
              className="relative w-10 shrink-0 bg-[var(--color-background-medium)]"
              role="meter"
              aria-label={`${balance.label} stock on common scale`}
              aria-valuemin={0}
              aria-valuemax={scale}
              aria-valuenow={wetBasis ? balance.wet! : balance.dry}
            >
              <div className="absolute inset-x-0 bottom-0 bg-[var(--acc-prod)]" style={{ height: `${Math.max(0, (wetBasis ? balance.wet! : balance.dry) / scale * PERCENT_SCALE)}%` }} />
            </div>
            <div className="min-w-0 flex-1 p-12 space-y-8">
              <div className="space-y-4">
                <p className="label-micro">{balance.label}</p>
                <h4 className="body-small font-semibold">{preview.binName}</h4>
                <p className="body-caption">{preview.binCode ? `${preview.binCode} · ` : ""}{preview.formulationName ?? binType}</p>
              </div>
              <div className="space-y-4">
                {wetBasis && <p className="body-medium">{formatMassKg(balance.wet)} wet estimate</p>}
                <p className={wetBasis ? "body-caption" : "body-medium"}>{formatMassKg(balance.dry)} dry biochar</p>
                {wetBasis && <p className="body-caption">At {formatMoisturePercent(preview.estimateMoisturePercent)} moisture</p>}
              </div>
              {balance.allocations && <BatchBalanceBar allocations={balance.allocations} scale={scale} wetBasis={wetBasis} colors={colors} stage={balance.label} />}
              {moreInfo}
            </div>
          </Card.Root>
        ))}
      </div>
      {preview.discrepancySolidsKg > 0 && <p role="status" className="body-small">Count exceeds tracked solids by {formatMassKg(preview.discrepancySolidsKg)}. This discrepancy adds no stock.</p>}
      {preview.blockingMessage && <p role="alert" className="body-small text-[var(--st-bad)]">{preview.blockingMessage}</p>}
      <div className="space-y-8">
        <h3 className="body-small font-semibold">{preview.binName}{preview.binCode ? ` (${preview.binCode})` : ""}</h3>
        <OutputStockAllocations allocations={preview.allocations} />
      </div>
    </section>
  );
}
