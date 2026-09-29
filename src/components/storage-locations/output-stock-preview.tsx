"use client";

import { CompositionCard, CompositionLedger, DerivedHeadline } from "@/components/forms";
import type { MassSegment } from "@/components/forms/composition-ledger";
import { useSimplePresence } from "@/components/forms/form-detail-context";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { backdatedNotice } from "@/lib/output-stock/messages";
import type { AffectedStockPreview as Preview, OutputStockBalanceView } from "@/types/output-stock";
import type { ReactNode } from "react";
import { MoistureResetChange } from "./moisture-reset-change";
import { IngredientStockInfo, StockLoadCard } from "./output-stock-load-card";
import { StockBalanceChange, StockNotice, StockRows, type StockRow } from "./stock-figures";
import { binLabel, capitalize, dryingNotice, formatWetEstimate, SPLIT_MATERIAL_LABEL, splitWetMassKg, STOCK_SIMPLE_PRESENCE, stockCardHint } from "./stock-preview-shared";

export { OutputStockAllocations, OutputStockAvailability } from "./output-stock-availability";

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
  const backdated = backdatedNotice(preview);
  const needsAttention = Boolean(blockingMessage) || Boolean(preview.blockers?.length) || preview.discrepancySolidsKg > 0 || Boolean(backdated);

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
      {backdated && <StockNotice>{backdated}</StockNotice>}
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
      {enteredWetKg !== null && <MoistureSplit calculation={false} wetMassKg={enteredWetKg} moisturePercent={preview.movementMoisturePercent} materialLabel={SPLIT_MATERIAL_LABEL} />}
      {notice && <StockNotice>{notice}</StockNotice>}
      {!refused && preview.moistureReset && <MoistureResetChange reset={preview.moistureReset} />}
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
  const moisture = preview.movementMoisturePercent === null ? "" : ` at ${formatMoisturePercent(preview.movementMoisturePercent)} moisture`;
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
  const { beforeEstimatedWetKg: before, afterEstimatedWetKg: after } = preview;
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
  if (preview.movementMoisturePercent !== null) {
    rows.push({ label: kind === "delivery" ? "Departure moisture" : "Moisture", value: formatMoisturePercent(preview.movementMoisturePercent) });
  }
  if (preview.removedDryKg !== null) {
    rows.push({ label: capitalize(`${dryLabel} ${kind === "delivery" ? "drawn" : "removed"}`), value: formatMassKg(Math.abs(preview.removedDryKg)) });
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
