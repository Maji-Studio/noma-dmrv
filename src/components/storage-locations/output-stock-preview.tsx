"use client";

import { useFormDetailLevel } from "@/components/forms/form-detail-context";
import { CompositionCard, CompositionLedger } from "@/components/forms";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import type {
  OutputStockAllocationView,
  AffectedStockPreview as Preview,
  OutputStockBalanceView,
} from "@/types/output-stock";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { SegmentBar, SegmentKey, batchAccentFill } from "@/components/ui/segment-bar";
import { useState, type ReactNode } from "react";
import { InlineMassChange, StockBalanceChange, StockNotice, StockRows, type StockRow } from "./stock-figures";

/**
 * The split bar divides a wet mass into dry solids and water, and dry solids are
 * not the tracked quantity: a blended product bin holding 84 kg of dry solids
 * holds 70 kg of dry biochar. Naming the segment "dry biochar" would put two
 * different masses under one label on the same block, so the bar says solids and
 * the balance pair keeps the tracked quantity.
 */
const SPLIT_MATERIAL_LABEL = "Solids";

/** The one definition the availability block cannot show as a number. */
const AVAILABILITY_HINT =
  "Dry biochar is the tracked quantity. Stock stays available to every order until a delivery records the bin it left.";

/**
 * Which batches a draw touched, and which run produced each one.
 *
 * Nothing renders when the draw touched no batch: a heading over the words "no
 * dry biochar removed" is a second copy of a number the block already shows.
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

/**
 * Batch layers as bar segments, each in its own accent.
 *
 * Every layer holds the same substance, so the `dry-batch` category cannot tell
 * two of them apart; the accent is what ties a segment to its key entry. Order
 * is the order the ledger returns, which is the order the draw consumed them.
 */
function batchSegments(allocations: readonly OutputStockBalanceView[]): MassSegment[] {
  return allocations.map((allocation, index) => ({
    label: allocation.code,
    mass: allocation.dryMassKg,
    category: "dry-batch",
    fill: batchAccentFill(index),
  }));
}

/**
 * A bin's current stock, for surfaces that pick a bin rather than move material.
 *
 * Same shape as the movement blocks: caption, the batches it holds as one bar,
 * the tracked quantity as the single headline figure, one action row. There is
 * no before and after because nothing is moving yet, and no wet figure because
 * wet availability depends on a departure moisture nobody has measured.
 */
export function OutputStockAvailability({ binName, binCode, subtitle, label, dryKg, dryLabel = "dry biochar", allocations = [], actions }: {
  binName: string;
  binCode?: string;
  /** What kind of bin this is, or the formulation it holds. */
  subtitle?: string | null;
  /** Names the headline figure, such as "Available dry stock". */
  label: string;
  dryKg: number | null;
  dryLabel?: string;
  allocations?: OutputStockAllocationView[];
  actions?: ReactNode;
}) {
  const segments = batchSegments(allocations);
  return (
    <CompositionCard
      title={binName}
      hint={AVAILABILITY_HINT}
      actions={actions}
      calculation={allocations.length > 0 ? <OutputStockAllocations allocations={allocations} /> : undefined}
    >
      {(binCode || subtitle) && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {binCode ? `${binCode}${subtitle ? " · " : ""}` : ""}{subtitle}
        </p>
      )}
      {segments.length > 0 && <div className="space-y-6">
        <SegmentBar label={`Batches in ${binName}`} segments={segments} />
        <SegmentKey segments={segments} />
      </div>}
      {/* Same treatment as the balance pair's headline, so one figure and a
          pair of them read as the same kind of answer. */}
      <div className="space-y-6">
        <span className="block body-caption text-[var(--color-text-secondary)]">{label}</span>
        <span className="block body-large font-medium tabular-nums">{formatMassKg(dryKg)} {dryLabel}</span>
      </div>
    </CompositionCard>
  );
}

/**
 * `hideBlockingMessage` is for forms that already render `preview.blockingMessage`
 * as the error on the field the operator must change. The same sentence in two
 * places reads as two separate problems, so the copy closest to the field wins
 * and the preview drops its own alert.
 */
export function OutputStockPreview({ followFormDetail = false, preview, moreInfo, renderBlocker, hideBlockingMessage = false }: { followFormDetail?: boolean; preview: Preview; moreInfo?: ReactNode; renderBlocker?: (blocker: NonNullable<Preview["blockers"]>[number]) => ReactNode; hideBlockingMessage?: boolean }) {
  const level = useFormDetailLevel();
  const detailed = !followFormDetail || level === "detailed";
  const blockingMessage = hideBlockingMessage ? null : preview.blockingMessage;

  return (
    <section hidden={followFormDetail && !detailed && !blockingMessage && !preview.blockers?.length && preview.discrepancySolidsKg <= 0} className="space-y-16" aria-label="Stock preview" aria-live="polite">
      {followFormDetail ? <div hidden={!detailed}>
        <StockMovementCard preview={preview} moreInfo={moreInfo} />
      </div> : (
        <StockLoadCard
          preview={preview}
          actions={moreInfo ?? (preview.lane === "ingredient" ? <IngredientStockInfo preview={preview} /> : null)}
        />
      )}
      {preview.discrepancySolidsKg > 0 && <StockNotice>Count exceeds tracked solids by {formatMassKg(preview.discrepancySolidsKg)}. This discrepancy adds no stock.</StockNotice>}
      {blockingMessage && <StockNotice tone="error" role="alert">{blockingMessage}</StockNotice>}
      {preview.blockers?.map(blocker => renderBlocker?.(blocker) ?? (blocker.entity === "binMovement" ? <span key={blocker.id}>{blocker.code}</span> : <a key={`${blocker.entity}:${blocker.id}`} className="body-small underline" href={blocker.entity === "binMovement" ? `/storage-locations?storageLocation=${preview.storageLocationId}&movement=${blocker.id}` : blocker.entity === "application" ? `/applications?ids=${blocker.id}` : blocker.entity === "ghgStatement" ? `/certification/ghg-statements?statement=${blocker.id}` : `/certification/removals?removal=${blocker.id}`}>{blocker.code}</a>))}
    </section>
  );
}

/**
 * What this movement does to the bin, in one block.
 *
 * Top to bottom it answers three questions in the order an operator asks them.
 * What did I enter: the wet mass drawn as a moisture split, so the dry share
 * that stock is kept in is visible instead of arithmetic. What does the bin hold
 * now: the balance before and after. How was that reached: the entered figures
 * and the FIFO draw, behind "Show calculation" because they restate the two
 * blocks above rather than adding to them.
 *
 * Definitions live in the title's hint; an operator confirming a correction
 * needs the numbers, not the vocabulary.
 */
function StockMovementCard({ preview, moreInfo }: { preview: Preview; moreInfo?: ReactNode }) {
  const headline = headlineBalance(preview);
  const enteredWetKg = splitWetMassKg(preview);
  const notice = dryingNotice(preview, enteredWetKg);
  const rows = movementRows(preview);
  const ledger = movementLedger(preview);
  return (
    <CompositionCard
      title={preview.binName}
      hint={stockCardHint(preview)}
      actions={moreInfo}
      calculation={rows.length > 0 || ledger ? <>
        {rows.length > 0 && <StockRows label="Figures behind this movement" rows={rows} />}
        {ledger}
      </> : undefined}
    >
      {enteredWetKg !== null && <div className="space-y-6">
        <p className="body-caption text-[var(--color-text-secondary)]">What you entered</p>
        {/* The block's own disclosure holds the arithmetic, so the split
            contributes the bar and its key line and no second ledger. */}
        <MoistureSplit calculation={false} wetMassKg={enteredWetKg} moisturePercent={preview.estimateMoisturePercent} materialLabel={SPLIT_MATERIAL_LABEL} />
      </div>}
      {notice && <StockNotice>{notice}</StockNotice>}
      <StockBalanceChange label={headline.label} beforeKg={headline.before} afterKg={headline.after} />
    </CompositionCard>
  );
}

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
function StockLoadCard({ preview, actions }: { preview: Preview; actions?: ReactNode }) {
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
        <MoistureSplit calculation={false} wetMassKg={enteredWetKg} moisturePercent={preview.estimateMoisturePercent} materialLabel={SPLIT_MATERIAL_LABEL} />
      </div>}
      {notice && <StockNotice>{notice}</StockNotice>}
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
 * The wet mass the split bar draws, or null when there is no split to draw.
 *
 * A removal carries the entered wet mass directly. A count does not: the planner
 * nulls `removedWetKg` for it and the counted mass reaches the preview as the
 * after wet estimate, which is the counted figure at the entered moisture. That
 * substitution only holds while the count is accepted in full, so a count that
 * exceeds tracked solids, or a preview whose balances were refused, keeps the
 * bar off rather than captioning a stale figure as an entry.
 *
 * A wet mass without moisture has no split either: the form's own moisture field
 * already carries that error, so an unresolved bar here would be a second copy.
 */
function splitWetMassKg(preview: Preview): number | null {
  if (preview.estimateMoisturePercent === null) return null;
  const counted = preview.blockingMessage === null && preview.discrepancySolidsKg <= 0
    ? preview.afterEstimatedWetKg
    : null;
  const entered = preview.removedWetKg === null ? counted : Math.abs(preview.removedWetKg);
  return entered !== null && entered > 0 ? entered : null;
}

/** Added or removed, from the sign the planner returns. */
function movementDirection(massKg: number): string {
  return massKg < 0 ? "added" : "removed";
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
  if (preview.estimateMoisturePercent !== null) {
    rows.push({ label: "Moisture", value: formatMoisturePercent(preview.estimateMoisturePercent) });
  }
  const estimate = preview.lane === "ingredient"
    ? { label: binLabel(dryLabel), before: preview.beforeDryKg, after: preview.afterDryKg }
    : { label: binLabel(preview.wetLabel ?? "wet estimate"), before: preview.beforeEstimatedWetKg, after: preview.afterEstimatedWetKg };
  if (estimate.before !== null && estimate.after !== null) {
    rows.push({ label: estimate.label, value: <InlineMassChange beforeKg={estimate.before} afterKg={estimate.after} /> });
  }
  return rows;
}

/**
 * The FIFO draw is the calculation; when a movement draws nothing, the layers it
 * leaves behind are, and an empty bin has neither.
 */
function movementLedger(preview: Preview): ReactNode {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  // Plain category fills here: the ledger is a table of figures, and it is the
  // one place in the movement block with no bar beside it to match a colour to.
  const layer = (allocation: OutputStockBalanceView): MassSegment => ({ label: allocation.code, mass: allocation.dryMassKg, category: "dry-batch" });
  const drawn = preview.allocations.map(layer);
  if (drawn.length > 0) {
    return <CompositionLedger hideZero label="Batches this movement draws from" totalLabel={capitalize(`${dryLabel} in this movement`)} total={Math.abs(preview.removedDryKg ?? 0)} segments={drawn} />;
  }
  const remaining = (preview.afterAllocations ?? []).map(layer);
  return remaining.length > 0
    ? <CompositionLedger hideZero label="Batch layers left in the bin" totalLabel={`Remaining ${dryLabel}`} total={preview.afterDryKg} segments={remaining} />
    : undefined;
}

/** Sentence case: the quantity labels are stored lowercase for prose. */
function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function binLabel(quantity: string): string {
  return capitalize(`${quantity} in bin`);
}

/**
 * A count that only changes moisture looks like a bug next to an unchanged
 * balance, so the one case that needs a sentence gets one, above the figures it
 * explains. Only an accepted count qualifies: a refused loss also arrives with
 * nothing removed, and its blocking message is the sentence that applies.
 */
function dryingNotice(preview: Preview, enteredWetKg: number | null): string | null {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const acceptedCount = preview.removedWetKg === null && preview.blockingMessage === null;
  return acceptedCount && preview.removedDryKg === 0 && enteredWetKg !== null
    ? `Drying alone does not remove ${dryLabel}.`
    : null;
}

/** The definition the block cannot show as a number. Kept to one hint. */
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
