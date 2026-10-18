"use client";

import { CompositionLedger } from "@/components/forms";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { InfoHint } from "@/components/ui/tooltip";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { formatFacilityTime } from "@/lib/date-utils";
import { formatFacilityDateTime, formatFacilityDay, formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { LOST_MASS_LABEL, outputStockEventLabel } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useState, type ReactNode } from "react";
import { MoistureResetChange } from "./moisture-reset-change";
import { StockSourceLink } from "./stock-source-link";
import { LedgerBeforeAfter, LedgerBreak, LedgerDayHeader, LedgerFacts, LedgerLine } from "./stock-ledger";
import { CalculationDisclosure } from "./stock-figures";
import { OutputStockForm } from "./output-stock-form";
import { FormDialog } from "@/components/ui/form-dialog";
import { Notice } from "@/components/ui/notice";

const ICON_PX = 16;
const TIME_FORMAT = "HH:mm";

/** A mode change moves no stock; it changes how every later removal is drawn. */
const MODE_CHANGE_CAPTIONS: Record<string, string> = {
  merge: "From here on the bin is one blended pile: each draw takes from every batch in proportion to what it holds.",
  split: "From here on each batch added is kept apart as its own sub-bin.",
};

/** The one fact the entries cannot show as a figure. */
const HISTORY_HINT =
  "Each entry is one measurement. Wet stock is the wet mass added less the wet mass taken out, and taking stock out leaves the moisture as it was. Earlier entries stay unchanged.";

/** The entry's own size with the moisture it was weighed at, for the original and corrected blocks. */
function entryFigure(entry: OutputStockHistoryEntry, kind: string): string {
  return `${entryAmount(entry, kind)}${entry.moisturePercent === null ? "" : ` at ${formatMoisturePercent(entry.moisturePercent)}`}`;
}

/** The entry's own size: what was weighed or counted, signed by direction. */
function entryAmount(entry: OutputStockHistoryEntry, kind: string): string {
  if (kind === "count") return entry.wetMassKg === null ? `${formatMassKg(entry.afterDryKg)} dry` : `${formatMassKg(entry.wetMassKg)} wet`;
  // dryMassKg is signed: removals positive, intakes negative.
  const sign = entry.dryMassKg > 0 ? "−" : entry.dryMassKg < 0 ? "+" : "";
  return entry.wetMassKg === null ? `${sign}${formatMassKg(Math.abs(entry.dryMassKg))} dry` : `${sign}${formatMassKg(entry.wetMassKg)} wet`;
}

interface LedgerRowProps {
  entry: OutputStockHistoryEntry;
  /** Movement kind the label and icon come from: the original kind for a correction. */
  kind: string;
  reversedEntry?: OutputStockHistoryEntry;
  /** The correction that replaced this entry, when one did. */
  replacedBy?: OutputStockHistoryEntry;
  moistureEntry?: OutputStockHistoryEntry;
  reversed: boolean;
  defaultOpen: boolean;
  timeZone: string;
  facilityId: string;
  onEdit: (entry: OutputStockHistoryEntry) => void;
}

/**
 * One operator action as one line: time, what happened, the entry's own size
 * and the dry biochar left after. Under the line: whether it still counts, the
 * bin before and after, what a correction changed, then who recorded it.
 */
function LedgerRow({ entry, kind, reversedEntry, replacedBy, moistureEntry, reversed, defaultOpen, timeZone, facilityId, onEdit }: LedgerRowProps) {
  const label = outputStockEventLabel(kind);
  const subject = `${label.toLowerCase()} on ${formatFacilityDateTime(entry.occurredAt, timeZone)}`;
  const recordedLater = entry.recordedAt.slice(0, 16) !== entry.occurredAt.slice(0, 16);
  const note = entry.reason && entry.kind !== "intake" ? entry.reason : entry.allocations.map((allocation) => allocation.code).join(", ");
  const chips = [...(reversed ? [replacedBy ? "Replaced" : "Reversed"] : []), ...(reversedEntry ? ["Correction"] : [])];
  return (
    <LedgerLine id={`output-movement-${entry.id}`} time={formatFacilityTime(new Date(entry.occurredAt), timeZone, TIME_FORMAT)}
      iconKind={entry.correctsMovementId && entry.kind !== "reversal" ? kind : entry.kind} label={label} chips={chips} note={note}
      amount={entryAmount(entry, kind)} after={formatMassKg(entry.afterDryKg)} struck={reversed} defaultOpen={defaultOpen}>
      {reversed && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {replacedBy ? `Replaced by the correction recorded ${formatFacilityDateTime(replacedBy.recordedAt, timeZone)}.` : "Reversed."} It no longer counts toward the stock.
        </p>
      )}
      <LedgerBeforeAfter title="Dry biochar in the bin" before={`${formatMassKg(entry.beforeDryKg)} dry`} after={`${formatMassKg(entry.afterDryKg)} dry`} />
      {reversedEntry && (
        <LedgerBeforeAfter title={`Corrects the ${label.toLowerCase()} from ${formatFacilityDateTime(reversedEntry.occurredAt, timeZone)}`} labels={["Original", "Corrected"]}
          before={{ value: entryFigure(reversedEntry, kind), caption: `${formatMassKg(reversedEntry.afterDryKg)} dry after` }}
          after={{ value: entryFigure(entry, kind), caption: `${formatMassKg(entry.afterDryKg)} dry after` }} />
      )}
      {moistureEntry?.moistureReset && <MoistureResetChange reset={moistureEntry.moistureReset} />}
      <LedgerFacts facts={[
        ...(entry.moisturePercent !== null && !reversedEntry ? [{ label: "Moisture", value: formatMoisturePercent(entry.moisturePercent) }] : []),
        ...(entry.reason && entry.kind !== "intake" ? [{ label: reversedEntry ? "Why corrected" : "Reason", value: entry.reason }] : []),
        { label: "Recorded", value: `${recordedLater ? formatFacilityDateTime(entry.recordedAt, timeZone) : "At the time"}${entry.actorName ? ` by ${entry.actorName}` : ""}` },
      ]} />
      {kind === "loss" && !reversed && (entry.editLockedReason === null
        ? <Button type="button" variant="noOutline" onClick={() => onEdit(entry)}>Edit</Button>
        : entry.editLockedReason ? <Notice tone="info">{entry.editLockedReason}</Notice> : null)}
      <StockSourceLink source={entry.source} facilityId={facilityId} />
      {entry.allocations.length > 0 && (
        <CalculationDisclosure subject={subject}>
          <CompositionLedger
            hideZero
            label={`Batches in the ${subject}`}
            totalLabel="Dry biochar in this entry"
            total={Math.abs(entry.dryMassKg)}
            segments={entry.allocations.map(allocation => ({ label: allocation.code, mass: allocation.dryMassKg, category: "dry-batch" as const }))}
          />
        </CalculationDisclosure>
      )}
    </LedgerLine>
  );
}

export function OutputStockHistory({ storageLocationId, facilityId, movementId, triggerLabel = "More info", compact = false, renderTrigger }: {
  storageLocationId: string;
  facilityId: string;
  movementId?: string;
  triggerLabel?: string;
  compact?: boolean;
  /** Draws the opener in the caller's own style, given the history icon. */
  renderTrigger?: (open: () => void, icon: ReactNode) => ReactNode;
}) {
  const clock = useFacilityClock(facilityId);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<OutputStockHistoryEntry | null>(null);
  const history = useOutputStockHistory(storageLocationId, open);
  const entries = history.data ?? [];
  const correctedIds = new Set(entries.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  // A reading stops counting once the entry that measured it is corrected.
  const isReversed = (entry: OutputStockHistoryEntry) => correctedIds.has(entry.measuredByMovementId ?? entry.id);
  const originalKind = (entry: OutputStockHistoryEntry): string => entry.eventKind ?? (entry.correctsMovementId ? originalKind(entries.find(item => item.id === entry.correctsMovementId) ?? { ...entry, correctsMovementId: null }) : entry.kind);
  // A movement opened on its own keeps the "Moisture updated" row its reading added.
  const shown = entries.filter(entry => !movementId || entry.id === movementId || entry.measuredByMovementId === movementId);
  // A correction posts a reversal plus a replacement against the same entry.
  // The replacement carries both, so a lone reversal row would double-count it.
  const foldedIntoReplacement = (entry: OutputStockHistoryEntry) =>
    entry.kind === "reversal" && shown.some(other => other.kind !== "reversal" && other.correctsMovementId === entry.correctsMovementId);
  // A reading's "Moisture updated" row folds into the movement that measured it.
  const moistureFor = (entry: OutputStockHistoryEntry) => shown.find(other => other.kind === "moisture_update" && other.measuredByMovementId === entry.id);
  const foldedIntoMovement = (entry: OutputStockHistoryEntry) =>
    entry.kind === "moisture_update" && shown.some(other => other.id === entry.measuredByMovementId);
  // A corrected entry stays in the list, struck through, beside the replacement that names it.
  const timeline = shown
    .filter(entry => !foldedIntoReplacement(entry) && !foldedIntoMovement(entry))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.recordedAt.localeCompare(a.recordedAt));
  const openHistory = () => setOpen(true);
  const icon = <ClockCounterClockwiseIcon size={compact ? 18 : ICON_PX} aria-hidden="true" />;

  return <>
    {renderTrigger ? renderTrigger(openHistory, icon) : (
      <Button type="button" variant={compact ? "noOutline" : "default"} className={compact ? "min-h-44 gap-8 px-8 normal-case" : undefined} onClick={openHistory}>{compact && icon}<span className={compact ? "body-caption normal-case" : undefined}>{triggerLabel}</span></Button>
    )}
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Stock history" width="md">
      <div className="space-y-20">
        <div className="flex items-center justify-between gap-12 pr-24">
          <h3 className="flex min-w-0 items-center gap-6 title-heading-3">
            <span className="truncate">Stock history</span>
            <InfoHint label="About stock history">{HISTORY_HINT}</InfoHint>
          </h3>
        </div>
          {history.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the stock history</p>}
          {history.error && <Notice tone="error">{history.error.message}</Notice>}
          {history.data?.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={32} />} title="No stock history" description="Recorded movements will appear here." padding="sm" />}
          {timeline.length > 0 && <div className="tabular-nums">
            {timeline.map((entry, index) => {
              const day = formatFacilityDay(entry.occurredAt, clock.timeZone);
              const dayHeader = index === 0 || day !== formatFacilityDay(timeline[index - 1].occurredAt, clock.timeZone)
                ? <LedgerDayHeader day={day} afterLabel={index === 0 ? "Dry biochar after" : undefined} /> : null;
              const kind = entry.correctsMovementId && entry.kind !== "reversal" ? originalKind(entry) : entry.kind;
              return <div key={entry.id}>
                {dayHeader}
                {MODE_CHANGE_CAPTIONS[entry.kind] ? (
                  <LedgerBreak id={`output-movement-${entry.id}`} iconKind={entry.kind} title={`${formatFacilityTime(new Date(entry.occurredAt), clock.timeZone, TIME_FORMAT)} ${outputStockEventLabel(entry.kind)}`} caption={MODE_CHANGE_CAPTIONS[entry.kind]} source={<StockSourceLink source={entry.source} facilityId={facilityId} />} />
                ) : (
                  <LedgerRow
                    entry={entry}
                    kind={kind}
                    timeZone={clock.timeZone}
                    reversedEntry={entry.correctsMovementId && entry.kind !== "reversal" ? entries.find(item => item.id === entry.correctsMovementId) : undefined}
                    replacedBy={entries.find(item => item.correctsMovementId === entry.id && item.kind !== "reversal")}
                    moistureEntry={moistureFor(entry)}
                    reversed={isReversed(entry)}
                    defaultOpen={!!movementId}
                    facilityId={facilityId}
                    onEdit={setEditing}
                  />
                )}
              </div>;
            })}
          </div>}
      </div>
    </Modal>
    <FormDialog isOpen={editing !== null} onClose={() => setEditing(null)} ariaLabel="Edit lost mass" width="md">
      <h3 className="title-heading-3 mb-20">{LOST_MASS_LABEL}</h3>
      {editing && <OutputStockForm key={editing.id} storageLocationId={storageLocationId} facilityId={facilityId} correction={editing}
        onCancel={() => setEditing(null)} onRecorded={() => setEditing(null)} />}
    </FormDialog>
  </>;
}
