"use client";

import { useSimplePresence, type SimplePresence } from "@/components/forms/form-detail-context";
import { CompositionCard, CompositionLedger, DerivedHeadline } from "@/components/forms";
import { formatCompositionMass, type MassSegment } from "@/components/forms/composition-ledger";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { MISSING_VALUE } from "@/lib/copy-utils";
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

/** Stock movement blocks are optional in Simple; see `OutputStockPreview`. */
const STOCK_SIMPLE_PRESENCE: SimplePresence = "hidden";

/** The one definition the availability block cannot show as a number. */
const AVAILABILITY_HINT =
  "Dry biochar is the tracked quantity. Wet availability depends on measured departure moisture. Stock stays available to every order until a delivery records the bin it left.";

/**
 * Wet estimates are whole kilograms. They are computed at an entered moisture,
 * not weighed, so a decimal would claim a precision the figure does not have.
 */
const WET_ESTIMATE_DIGITS = 0;

/** What the operator entered, named the way the form's own fields name it. */
export type StockEntryKind = "correction" | "loss" | "count" | "delivery";

/** The entry behind a movement block: its kind and the wet mass as typed. */
export interface StockEntry {
  kind: StockEntryKind;
  wetMassKg: number | null | undefined;
}

/** "310 kg wet removed", "48 kg wet lost", "1,190 kg wet loaded". A count reads "Counted …". */
const ENTRY_VERB: Record<Exclude<StockEntryKind, "count">, string> = {
  correction: "removed",
  loss: "lost",
  delivery: "loaded",
};

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

/** Key figures under a wet headline: batches are tracked dry, so they say so. */
function formatDryKeyMass(kg: number | null): string {
  return `${formatCompositionMass(kg)} dry`;
}

/** Whole kilograms without the unit, for the muted before figure of a pair. */
function formatWetEstimate(kg: number): string {
  return kg.toLocaleString(undefined, { maximumFractionDigits: WET_ESTIMATE_DIGITS });
}

/**
 * A bin's current stock, for surfaces that pick a bin rather than move material.
 *
 * Same shape as the movement blocks: caption, one headline figure, the batches
 * the bin holds as one bar and its key, then the tracked dry stock as a row in
 * Detailed, then one action row. There is no before and after because nothing
 * is moving yet.
 *
 * Operators plan loads in wet mass, so the headline is the wet estimate when a
 * moisture gives one (`wetEstimate`, with the basis it was computed at as its
 * caption). Without it the dry stock is the only honest figure and takes the
 * headline itself: a wet number at a moisture nobody measured would be made up.
 */
export function OutputStockAvailability({ binName, dryKg, wetEstimate = null, allocations = [], actions }: {
  binName: string;
  dryKg: number | null;
  /** Wet stock at a known moisture, and a caption naming that moisture. */
  wetEstimate?: { kg: number; basis: string } | null;
  allocations?: OutputStockAllocationView[];
  actions?: ReactNode;
}) {
  // A spent batch holds nothing to order against, so it stays off the block.
  const held = allocations.filter(allocation => allocation.dryMassKg > 0);
  const segments = batchSegments(held);
  const dry = dryKg == null ? MISSING_VALUE.notAvailable : `${formatMassKg(dryKg)} dry biochar`;
  return (
    <CompositionCard
      title={binName}
      hint={AVAILABILITY_HINT}
      actions={actions}
      calculation={held.length > 0 ? <OutputStockAllocations allocations={held} /> : undefined}
      headline={wetEstimate
        ? <DerivedHeadline label="Available wet stock, estimate" value={`≈ ${formatWetEstimate(wetEstimate.kg)} kg wet`} sub={wetEstimate.basis} />
        : <DerivedHeadline label="Available dry stock" value={dry} />}
      detail={wetEstimate ? <StockRows label="Tracked stock" rows={[{ label: "Available dry stock", value: dry }]} /> : undefined}
    >
      {segments.length > 0 && <div className="flex flex-col gap-6">
        <SegmentBar label={`Batches in ${binName}`} segments={segments} />
        <SegmentKey segments={segments} format={formatDryKeyMass} />
      </div>}
    </CompositionCard>
  );
}

/**
 * `variant` picks the block: `movement` for a surface that records one movement
 * against one bin (a correction, a loss, a count, a delivery load), `load` for
 * a surface that shows several bins at once (the product form).
 *
 * The stock family is hidden in Simple: the entry fields already say what the
 * operator is doing. Refusals, blockers and discrepancies are not optional, so
 * they stay visible at both levels.
 *
 * `entry` is what the operator typed on a movement surface: its kind names the
 * movement in the headline's caption ("310 kg wet removed at 22.7% moisture"),
 * and its wet mass is the one figure a count cannot recover from the preview.
 *
 * `hideBlockingMessage` is for forms that already render `preview.blockingMessage`
 * as the error on the field the operator must change. The same sentence in two
 * places reads as two separate problems, so the copy closest to the field wins
 * and the preview drops its own alert.
 */
export function OutputStockPreview({ variant = "load", preview, entry, moreInfo, renderBlocker, hideBlockingMessage = false }: { variant?: "movement" | "load"; preview: Preview; entry?: StockEntry; moreInfo?: ReactNode; renderBlocker?: (blocker: NonNullable<Preview["blockers"]>[number]) => ReactNode; hideBlockingMessage?: boolean }) {
  const parts = useSimplePresence(STOCK_SIMPLE_PRESENCE);
  const blockingMessage = hideBlockingMessage ? null : preview.blockingMessage;
  const needsAttention = Boolean(blockingMessage) || Boolean(preview.blockers?.length) || preview.discrepancySolidsKg > 0;

  // The live region stays mounted while the level hides it, so a blocker that
  // appears later is still announced.
  return (
    <section hidden={!parts.block && !needsAttention} className="flex flex-col gap-16" aria-label="Stock preview" aria-live="polite">
      {variant === "movement" ? (
        <StockMovementCard preview={preview} entry={entry} moreInfo={moreInfo} />
      ) : (
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
 * Operators weigh and load wet mass, so the block leads with the bin's wet
 * stock before and after, labelled as an estimate because it is the tracked
 * solids at the moisture entered here, not a weighing. Its caption is the entry
 * itself. Under it the entered wet mass as a moisture split, then the one
 * notice a drying only count needs, then the tracked dry balance as a row in
 * Detailed: stock is kept in dry biochar, only the presentation leads wet. The
 * entered figures and the FIFO draw sit behind "Show calculation".
 *
 * Without a moisture there is no wet estimate to show, so the dry balance takes
 * the headline instead of a made up figure. The ingredient lane tracks wet stock
 * directly, so its headline is the same pair without the estimate label.
 *
 * Definitions live in the title's hint; an operator confirming a correction
 * needs the numbers, not the vocabulary.
 */
function StockMovementCard({ preview, entry, moreInfo }: { preview: Preview; entry?: StockEntry; moreInfo?: ReactNode }) {
  const kind = entryKind(preview, entry);
  // A refused movement changes nothing. The block keeps the current balance
  // and the entry without its verb, so it cannot read as applied, even where
  // the form shows the refusal on a field instead of in this block.
  const refused = preview.blockingMessage != null;
  const enteredWetKg = splitWetMassKg(preview);
  const line = enteredLine(preview, kind, entry, refused);
  const wet = wetBalance(preview);
  const dry = dryBalance(preview);
  const notice = dryingNotice(preview, enteredWetKg);
  const rows = entryRows(preview, kind, entry);
  const ledger = movementLedger(preview);
  const dryPair = dry && <StockBalanceChange variant={wet ? "row" : "headline"} label={dry.label} beforeKg={dry.before} afterKg={refused ? undefined : dry.after} supportingLine={wet ? undefined : line} />;
  return (
    <CompositionCard
      title={preview.binName}
      hint={stockCardHint(preview)}
      simple={STOCK_SIMPLE_PRESENCE}
      actions={moreInfo}
      headline={wet
        ? refused
          ? <DerivedHeadline label={wet.label} value={wet.current} sub={line} />
          : <DerivedHeadline label={wet.label} before={wet.before} value={wet.after} figureLabel={wet.figureLabel} sub={line} />
        : dryPair}
      detail={wet ? dryPair : undefined}
      calculation={rows.length > 0 || ledger ? <>
        {rows.length > 0 && <StockRows label="Figures behind this movement" rows={rows} />}
        {ledger}
      </> : undefined}
    >
      {/* The block's own disclosure holds the arithmetic, so the split
          contributes the bar and its key line and no second ledger. */}
      {enteredWetKg !== null && <MoistureSplit calculation={false} wetMassKg={enteredWetKg} moisturePercent={preview.estimateMoisturePercent} materialLabel={SPLIT_MATERIAL_LABEL} />}
      {notice && <StockNotice>{notice}</StockNotice>}
    </CompositionCard>
  );
}

/** A preview without an entry reads as a count when nothing was removed. */
function entryKind(preview: Preview, entry?: StockEntry): StockEntryKind {
  return entry?.kind ?? (preview.removedWetKg === null ? "count" : "correction");
}

/**
 * The wet mass as entered. The typed figure wins over the preview's, because a
 * count reaches the preview only as an after balance, and only while accepted.
 */
function enteredWetMassKg(preview: Preview, entry?: StockEntry): number | null {
  const typed = entry?.wetMassKg;
  if (typed != null && Number.isFinite(typed)) return typed;
  return preview.removedWetKg === null ? splitWetMassKg(preview) : Math.abs(preview.removedWetKg);
}

/**
 * The entry as one caption: "310 kg wet removed at 22.7% moisture", "Counted
 * 2,650 kg wet at 27.4% moisture". A refused entry drops the verb: "310 kg wet
 * at 22.7% moisture".
 */
function enteredLine(preview: Preview, kind: StockEntryKind, entry: StockEntry | undefined, refused: boolean): string | null {
  const wetKg = enteredWetMassKg(preview, entry);
  if (wetKg === null) return null;
  const moisture = preview.estimateMoisturePercent === null ? "" : ` at ${formatMoisturePercent(preview.estimateMoisturePercent)} moisture`;
  if (refused) return `${formatMassKg(wetKg)} wet${moisture}`;
  return kind === "count"
    ? `Counted ${formatMassKg(wetKg)} wet${moisture}`
    : `${formatMassKg(wetKg)} wet ${ENTRY_VERB[kind]}${moisture}`;
}

/**
 * The headline pair in wet mass, or null when no moisture gives one. Output
 * bins estimate it at the entered moisture; ingredient bins track it.
 */
function wetBalance(preview: Preview): { label: string; before: string; after: string; current: string; figureLabel: string } | null {
  const { afterEstimatedWetKg: after } = preview;
  // A count's before is what the records say the bin holds; see `beforeRecordedWetKg`.
  const before = preview.beforeRecordedWetKg ?? preview.beforeEstimatedWetKg;
  if (before === null || after === null) return null;
  if (preview.lane === "ingredient") {
    const label = binLabel(preview.wetLabel ?? "wet stock");
    return { label, before: formatMassKg(before), after: formatMassKg(after), current: formatMassKg(before), figureLabel: `${label}: ${formatMassKg(before)} before, ${formatMassKg(after)} after` };
  }
  const label = "Wet stock in bin, estimate";
  return {
    label,
    before: `≈ ${formatWetEstimate(before)}`,
    after: `${formatWetEstimate(after)} kg`,
    current: `≈ ${formatWetEstimate(before)} kg`,
    figureLabel: `${label}: about ${formatWetEstimate(before)} kg before, ${formatWetEstimate(after)} kg after`,
  };
}

/** The tracked quantity before and after, or null when the lane has no estimate of it. */
function dryBalance(preview: Preview): { label: string; before: number | null; after: number | null } | null {
  if (preview.beforeDryKg === null && preview.afterDryKg === null) return null;
  return { label: binLabel(preview.dryLabel ?? "dry biochar"), before: preview.beforeDryKg, after: preview.afterDryKg };
}

/**
 * The entered figures and the dry mass they move, in the order and words of
 * the entry fields. The balances are already on the block, so none repeats here.
 */
function entryRows(preview: Preview, kind: StockEntryKind, entry?: StockEntry): StockRow[] {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const rows: StockRow[] = [];
  const wetKg = enteredWetMassKg(preview, entry);
  if (wetKg !== null) {
    rows.push({ label: kind === "count" ? "Counted wet mass" : kind === "delivery" ? "Wet loaded" : "Wet removed", value: formatMassKg(wetKg) });
  }
  if (preview.estimateMoisturePercent !== null) {
    rows.push({ label: kind === "delivery" ? "Departure moisture" : "Moisture", value: formatMoisturePercent(preview.estimateMoisturePercent) });
  }
  if (preview.removedDryKg !== null) {
    rows.push({ label: capitalize(`${dryLabel} ${kind === "delivery" ? "drawn" : "removed"}`), value: formatMassKg(Math.abs(preview.removedDryKg)) });
  }
  return rows;
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
      simple={STOCK_SIMPLE_PRESENCE}
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
/**
 * Only a count below the recorded wet stock reads as lost material, so only
 * then does the block say drying removes none. A count at or above it needs no
 * explanation, and without a recorded figure there is nothing to compare with.
 */
function dryingNotice(preview: Preview, enteredWetKg: number | null): string | null {
  const dryLabel = preview.dryLabel ?? "dry biochar";
  const acceptedCount = preview.removedWetKg === null && preview.blockingMessage === null;
  const estimate = preview.beforeRecordedWetKg ?? null;
  const belowEstimate = enteredWetKg !== null && estimate !== null
    && Math.round(enteredWetKg) < Math.round(estimate);
  return acceptedCount && preview.removedDryKg === 0 && belowEstimate
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
