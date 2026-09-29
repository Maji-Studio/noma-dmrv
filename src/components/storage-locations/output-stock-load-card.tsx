"use client";

import { CompositionCard } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { SegmentBar, SegmentKey } from "@/components/ui/segment-bar";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type { AffectedStockPreview as Preview } from "@/types/output-stock";
import { useState, type ReactNode } from "react";
import { MoistureResetChange } from "./moisture-reset-change";
import { OutputStockAllocations } from "./output-stock-availability";
import { InlineMassChange, StockBalanceChange, StockNotice, StockRows, type StockRow } from "./stock-figures";
import { batchSegments, binLabel, capitalize, dryingNotice, movementDirection, SPLIT_MATERIAL_LABEL, splitWetMassKg, stockCardHint } from "./stock-preview-shared";

/**
 * What this movement does to one bin, on the surfaces that show several bins at
 * once: a product draws from a biochar bin and its ingredient bins and fills a
 * product bin, and each of the three gets one of these.
 *
 * The shape is the movement block's, so a bin reads the same wherever it
 * appears. What differs is the bar. Here the operator did not enter this bin's
 * mass field by field; what the bin contributes is a share of specific batches,
 * so the bar is one segment per batch in its own accent and the caption carries
 * the total the bar stands for. A movement with no batch to name (an ingredient
 * withdrawal, a bin receiving new material) falls back to the moisture split of
 * what was entered, which is the same bar the movement block draws.
 */
export function StockLoadCard({ preview, actions }: { preview: Preview; actions?: ReactNode }) {
  const headline = headlineBalance(preview);
  const drawn = batchSegments(preview.allocations);
  const enteredWetKg = splitWetMassKg(preview);
  const notice = dryingNotice(preview, enteredWetKg);
  const rows = movementRows(preview);
  return (
    <CompositionCard
      title={preview.binName}
      hint={stockCardHint(preview)}
      actions={actions}
      calculation={rows.length > 0 || preview.allocations.length > 0 ? <>
        {rows.length > 0 && <StockRows label="Figures behind this movement" rows={rows} />}
        <OutputStockAllocations allocations={preview.allocations} />
      </> : undefined}
    >
      {drawn.length > 0 ? <div className="space-y-6">
        <p className="body-caption text-[var(--color-text-secondary)]">{drawnCaption(preview)}</p>
        <SegmentBar label={`Batches ${preview.binName} contributes`} segments={drawn} />
        <SegmentKey segments={drawn} />
      </div> : enteredWetKg !== null && <div className="space-y-6">
        <p className="body-caption text-[var(--color-text-secondary)]">{enteredCaption(preview)}</p>
        <MoistureSplit calculation={false} wetMassKg={enteredWetKg} moisturePercent={preview.movementMoisturePercent} materialLabel={SPLIT_MATERIAL_LABEL} />
      </div>}
      {notice && <StockNotice>{notice}</StockNotice>}
      {preview.blockingMessage === null && preview.moistureReset && <MoistureResetChange reset={preview.moistureReset} />}
      <StockBalanceChange label={headline.label} beforeKg={headline.before} afterKg={headline.after} />
    </CompositionCard>
  );
}

/** The tracked quantity of the lane, before and after: the block's headline. */
function headlineBalance(preview: Preview): { label: string; before: number | null; after: number | null } {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  return preview.lane === "ingredient"
    ? { label: binLabel(preview.wetLabel ?? "wet stock"), before: preview.beforeEstimatedWetKg, after: preview.afterEstimatedWetKg }
    : { label: binLabel(dryLabel), before: preview.beforeDryKg, after: preview.afterDryKg };
}

/**
 * The dry total the batch bar stands for, and which way it moved. The layers
 * carry the figure when the planner reports no dry movement of its own, so the
 * caption never reads "Not recorded" over a bar that clearly shows a mass.
 */
function drawnCaption(preview: Preview): string {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const dry = preview.removedDryKg ?? preview.allocations.reduce((total, allocation) => total + allocation.dryMassKg, 0);
  return `${formatMassKg(Math.abs(dry))} ${dryLabel} ${movementDirection(dry)}`;
}

/** The wet total the split bar stands for. A count entered no movement to name. */
function enteredCaption(preview: Preview): string {
  return preview.removedWetKg === null
    ? "What you entered"
    : `${formatMassKg(Math.abs(preview.removedWetKg))} wet ${movementDirection(preview.removedWetKg)}`;
}

/**
 * The entered figures and the estimate the headline leaves out. These are the
 * inputs, not the consequence, so they sit behind the disclosure.
 */
function movementRows(preview: Preview): StockRow[] {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const rows: StockRow[] = [];
  if (preview.removedWetKg !== null) {
    rows.push({ label: capitalize(`wet ${movementDirection(preview.removedWetKg)}`), value: formatMassKg(Math.abs(preview.removedWetKg)) });
  }
  if (preview.removedDryKg !== null) {
    rows.push({ label: capitalize(`${dryLabel} ${movementDirection(preview.removedDryKg)}`), value: formatMassKg(Math.abs(preview.removedDryKg)) });
  }
  if (preview.movementMoisturePercent !== null) {
    rows.push({ label: "Moisture", value: formatMoisturePercent(preview.movementMoisturePercent) });
  }
  const estimate = preview.lane === "ingredient"
    ? { label: binLabel(dryLabel), before: preview.beforeDryKg, after: preview.afterDryKg }
    : { label: binLabel(preview.wetLabel ?? "wet estimate"), before: preview.beforeEstimatedWetKg, after: preview.afterEstimatedWetKg };
  if (estimate.before !== null && estimate.after !== null) {
    rows.push({ label: estimate.label, value: <InlineMassChange beforeKg={estimate.before} afterKg={estimate.after} /> });
  }
  return rows;
}

export function IngredientStockInfo({ preview }: { preview: Preview }) {
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
