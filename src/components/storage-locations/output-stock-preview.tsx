"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { CompositionCard, CompositionLedger } from "@/components/forms";
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
import { formatWetMeasurement, StockBalanceChange, StockNotice } from "./stock-figures";

const PERCENT_SCALE = 100;
const EMPTY_SCALE_KG = 1;
const BATCH_COLORS = ["var(--acc-prod)", "var(--acc-infra)", "var(--acc-dist)"];

/**
 * Which batches a draw touched, and which run produced each one.
 *
 * Nothing renders when the draw touched no batch: a heading over the words "no
 * dry biochar removed" is a second copy of a number the card already shows.
 */
export function OutputStockAllocations({ allocations }: { allocations: OutputStockAllocationView[] }) {
  if (allocations.length === 0) return null;
  return (
    <div className="space-y-8" aria-label="Batch breakdown">
      <h4 className="body-small font-medium">Batch breakdown</h4>
      <dl className="space-y-8">
        {allocations.map((allocation) => (
          <div key={allocation.layerId} className="space-y-2">
            <div className="flex items-baseline justify-between gap-12">
              <dt className="body-caption">{allocation.code}</dt>
              <dd className="body-small tabular-nums text-right">{formatMassKg(allocation.dryMassKg)}</dd>
            </div>
            {allocation.runs.map((run) => (
              <div key={run.productionRunId} className="flex items-baseline justify-between gap-12 pl-12">
                <dt className="body-caption text-[var(--color-text-secondary)]">Source run {run.code}</dt>
                <dd className="body-caption tabular-nums text-right text-[var(--color-text-secondary)]">{formatMassKg(run.dryMassKg)}</dd>
              </div>
            ))}
          </div>
        ))}
      </dl>
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

/**
 * `hideBlockingMessage` is for forms that already render `preview.blockingMessage`
 * as the error on the field the operator must change. The same sentence in two
 * places reads as two separate problems, so the copy closest to the field wins
 * and the preview drops its own alert.
 */
export function OutputStockPreview({ followFormDetail = false, preview, moreInfo, commonScale, renderBlocker, hideBlockingMessage = false }: { followFormDetail?: boolean; preview: Preview; moreInfo?: ReactNode; commonScale?: number; renderBlocker?: (blocker: NonNullable<Preview["blockers"]>[number]) => ReactNode; hideBlockingMessage?: boolean }) {
  const level = useFormDetailLevel();
  const detailed = !followFormDetail || level === "detailed";
  const blockingMessage = hideBlockingMessage ? null : preview.blockingMessage;
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
    <section hidden={followFormDetail && !detailed && !blockingMessage && !preview.blockers?.length && preview.discrepancySolidsKg <= 0} className="space-y-16" aria-label="Stock preview" aria-live="polite">
      {followFormDetail ? <div hidden={!detailed}>
        <StockMovementCard preview={preview} moreInfo={moreInfo} />
      </div> : <>
      <div>
        {preview.removedWetKg !== null && <p className="body-large font-semibold">{formatMassKg(Math.abs(preview.removedWetKg))} wet {preview.removedWetKg < 0 ? "added" : "removed"}</p>}
        <p className={preview.removedWetKg === null ? "body-large font-semibold" : "body-caption text-[var(--color-text-secondary)]"}>
          {formatMassKg(preview.removedDryKg === null ? null : Math.abs(preview.removedDryKg))} {dryLabel} {preview.removedDryKg !== null && preview.removedDryKg < 0 ? "added" : "removed"}
        </p>
      </div>
      {detailed ? <>
      <p className="body-caption">
        {preview.wetLabel ? "Recorded wet stock. " : wetBasis ? `Wet estimates at ${formatMoisturePercent(preview.estimateMoisturePercent)} moisture. ` : "No moisture measurement was entered. "}
        Both bars use the same {formatMassKg(scale)} {preview.wetLabel ?? (wetBasis ? "wet estimate" : dryLabel)} scale.
        {preview.wetLabel ? " Dry solids use the recorded intake basis." : wetBasis ? " These estimates do not replace recorded pile measurements." : " Wet estimates need a moisture measurement."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-16">
        {balances.map((balance) => (
          <OutputStockBalanceCard key={balance.label} preview={preview} balance={balance} scale={scale} wetBasis={wetBasis} colors={colors} moreInfo={(followFormDetail ? null : moreInfo) ?? (preview.lane === "ingredient" ? <IngredientStockInfo preview={preview} /> : null)} />
        ))}
      </div>
      </> : <div className="space-y-4">
        <p className="body-small">{preview.binName}</p>
        {balances.map(balance => <p key={balance.label} className="body-caption">{balance.label}: {formatMassKg(balance.dry)} {dryLabel}{wetBasis ? ` · ${formatMassKg(balance.wet)} ${preview.wetLabel ?? "wet estimate"}` : ""}</p>)}
        <p className="body-caption">{preview.wetLabel ? "Dry solids use the recorded intake basis." : wetBasis ? `Wet estimates at ${formatMoisturePercent(preview.estimateMoisturePercent)} moisture do not replace recorded pile measurements.` : "Wet estimates need a moisture measurement."}</p>
      </div>}
      </>}
      {preview.discrepancySolidsKg > 0 && <StockNotice>Count exceeds tracked solids by {formatMassKg(preview.discrepancySolidsKg)}. This discrepancy adds no stock.</StockNotice>}
      {blockingMessage && <StockNotice tone="error" role="alert">{blockingMessage}</StockNotice>}
      {preview.blockers?.map(blocker => renderBlocker?.(blocker) ?? (blocker.entity === "binMovement" ? <span key={blocker.id}>{blocker.code}</span> : <a key={`${blocker.entity}:${blocker.id}`} className="body-small underline" href={blocker.entity === "binMovement" ? `/storage-locations?storageLocation=${preview.storageLocationId}&movement=${blocker.id}` : blocker.entity === "application" ? `/applications?ids=${blocker.id}` : blocker.entity === "ghgStatement" ? `/certification/ghg-statements?statement=${blocker.id}` : `/certification/removals?removal=${blocker.id}`}>{blocker.code}</a>))}
      {!followFormDetail && detailed && preview.lane !== "ingredient" && preview.allocations.length > 0 && <div className="space-y-8">
        <h3 className="body-small font-medium">{preview.binName}{preview.binCode ? ` (${preview.binCode})` : ""}</h3>
        <OutputStockAllocations allocations={preview.allocations} />
      </div>}
    </section>
  );
}

/**
 * What this movement does to the bin, in one card.
 *
 * The headline is the consequence (the balance before and after), the caption
 * is the movement that produced it, and the FIFO layers are the only content
 * worth a disclosure. Definitions live in the title's hint, because an operator
 * confirming a correction needs the numbers, not the vocabulary.
 */
function StockMovementCard({ preview, moreInfo }: { preview: Preview; moreInfo?: ReactNode }) {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const ingredient = preview.lane === "ingredient";
  const headline = ingredient
    ? { label: binLabel(preview.wetLabel ?? "wet stock"), before: preview.beforeEstimatedWetKg, after: preview.afterEstimatedWetKg }
    : { label: binLabel(dryLabel), before: preview.beforeDryKg, after: preview.afterDryKg };
  const drawn = preview.allocations.map(layer => ({ label: layer.code, mass: layer.dryMassKg, category: "dry-batch" as const }));
  const remaining = (preview.afterAllocations ?? []).map(layer => ({ label: layer.code, mass: layer.dryMassKg, category: "dry-batch" as const }));
  // The FIFO draw is the calculation; when a movement draws nothing, the layers
  // it leaves behind are, and an empty bin has neither.
  const calculation = drawn.length > 0
    ? <CompositionLedger hideZero label="Batches this movement draws from" totalLabel={capitalize(`${dryLabel} in this movement`)} total={Math.abs(preview.removedDryKg ?? 0)} segments={drawn} />
    : remaining.length > 0
      ? <CompositionLedger hideZero label="Batch layers left in the bin" totalLabel={`Remaining ${dryLabel}`} total={preview.afterDryKg} segments={remaining} />
      : undefined;
  return (
    <CompositionCard
      title={preview.binName}
      hint={stockCardHint(preview)}
      calculation={calculation}
    >
      <StockBalanceChange label={headline.label} beforeKg={headline.before} afterKg={headline.after} supportingLine={movementCaption(preview)} />
      {moreInfo}
    </CompositionCard>
  );
}

/** Sentence case: the quantity labels are stored lowercase for prose. */
function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function binLabel(quantity: string): string {
  return capitalize(`${quantity} in bin`);
}

/** One sentence naming what the movement does, never a restatement of a row. */
function movementCaption(preview: Preview): string {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const dry = preview.removedDryKg;
  const wet = preview.removedWetKg;
  if (dry === null || dry === 0) {
    const counted = preview.afterEstimatedWetKg;
    return counted === null
      ? `No ${dryLabel} removed.`
      : `Counted ${formatWetMeasurement(counted, preview.estimateMoisturePercent)}, no ${dryLabel} removed.`;
  }
  const verb = dry < 0 ? "Adds" : "Removes";
  const mass = formatMassKg(Math.abs(dry));
  return wet === null
    ? `${verb} ${mass} ${dryLabel}.`
    : `${verb} ${mass} ${dryLabel} (${formatWetMeasurement(Math.abs(wet), preview.estimateMoisturePercent)}).`;
}

/** The definition the card cannot show as a number. Kept to one hint. */
function stockCardHint(preview: Preview): string {
  if (preview.lane === "ingredient") {
    return "Wet stock is the recorded intake less tracked withdrawals. The moisture entered here describes this withdrawal only.";
  }
  return preview.removedDryKg === 0
    ? "Dry biochar is the tracked quantity, and drying alone does not change it. Wet stock is an estimate at the moisture you enter."
    : "Dry biochar is the tracked quantity. Wet stock is an estimate at the moisture you enter and does not replace a recorded pile measurement.";
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
