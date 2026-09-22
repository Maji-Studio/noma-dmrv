"use client";

import { CompositionLedger } from "@/components/forms";
import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { InfoHint } from "@/components/ui/tooltip";
import { useOutputStockHistory } from "@/hooks/use-output-stock";
import { MISSING_VALUE } from "@/lib/copy-utils";
import { formatDate, formatDateTime } from "@/lib/format-utils";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { ClockCounterClockwiseIcon, PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { useState } from "react";
import { OutputStockForm } from "./output-stock-form";
import {
  CalculationDisclosure,
  formatWetAtMoisture,
  InlineMassChange,
  StockChip,
  StockNotice,
  StockRows,
} from "./stock-figures";

const CORRECTABLE_KINDS = ["loss", "count", "delivery"];

/** The one fact the entries cannot show as a figure. */
const HISTORY_HINT =
  "Each entry is one measurement. Current wet stock stays an estimate at the latest moisture, so a later moisture never rewrites an earlier measurement.";

interface EntryProps {
  entry: OutputStockHistoryEntry;
  kindLabel: string;
  reversedEntry?: OutputStockHistoryEntry;
  reversed: boolean;
  correctable: boolean;
  last: boolean;
  onCorrect: () => void;
}

/**
 * One movement on the bin's timeline.
 *
 * The rail carries the sequence, the chip names the move, and the figures sit
 * in aligned rows. A correction folds its reversal into the replacement it
 * belongs to, so one operator action reads as one entry.
 */
function HistoryEntry({ entry, kindLabel, reversedEntry, reversed, correctable, last, onCorrect }: EntryProps) {
  const subject = `${kindLabel.toLowerCase()} on ${formatDate(entry.physicalDate)}`;
  const rows = [
    ...(entry.wetMassKg === null ? [] : [{ label: "Wet", value: formatWetAtMoisture(entry.wetMassKg, entry.moisturePercent) }]),
    { label: "Dry biochar", value: <InlineMassChange beforeKg={entry.beforeDryKg} afterKg={entry.afterDryKg} /> },
  ];
  return (
    <li className="flex gap-12">
      <div className="flex flex-col items-center" aria-hidden="true">
        <span className={`mt-6 size-8 shrink-0 rounded-full ${reversed ? "border border-[var(--color-border-primary)]" : "bg-[var(--color-text-primary)]"}`} />
        {!last && <span className="w-1 flex-1 bg-[var(--color-border-tertiary)]" />}
      </div>
      <article id={`output-movement-${entry.id}`} className="min-w-0 flex-1 space-y-8 pb-24">
        <div className="flex items-center justify-between gap-12">
          <h4 className="flex min-w-0 items-center gap-6">
            <StockChip emphasis>{kindLabel}</StockChip>
            {reversed && <StockChip>Reversed</StockChip>}
          </h4>
          <span className="body-caption tabular-nums whitespace-nowrap text-[var(--color-text-tertiary)]">{formatDate(entry.physicalDate)}</span>
        </div>
        <StockRows label={`${kindLabel} figures`} rows={rows} />
        {reversedEntry && (
          <p className="body-caption text-[var(--color-text-secondary)]">
            Reverses the entry recorded {formatDate(reversedEntry.physicalDate)}.
          </p>
        )}
        {entry.reason && <p className="body-caption text-[var(--color-text-secondary)]">{entry.reason}</p>}
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Recorded {formatDateTime(entry.recordedAt)} by {entry.actorName ?? MISSING_VALUE.notRecorded}
        </p>
        {entry.allocations.length > 0 && (
          <CalculationDisclosure subject={subject}>
            <CompositionLedger
              hideZero
              label={`Batches drawn by the ${subject}`}
              totalLabel="Dry biochar in this entry"
              total={entry.dryMassKg}
              segments={entry.allocations.map(allocation => ({ label: allocation.code, mass: allocation.dryMassKg, category: "dry-batch" as const }))}
            />
          </CalculationDisclosure>
        )}
        {correctable && (
          <Button type="button" variant="noOutline" className="min-h-44 gap-8 px-8 normal-case" onClick={onCorrect}>
            <PencilSimpleIcon size={16} aria-hidden="true" />
            <span className="body-caption normal-case">Correct entry</span>
          </Button>
        )}
      </article>
    </li>
  );
}

export function OutputStockHistory({ storageLocationId, facilityId, movementId, triggerLabel = "More info", compact = false }: { storageLocationId: string; facilityId: string; movementId?: string; triggerLabel?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState<OutputStockHistoryEntry>();
  const history = useOutputStockHistory(storageLocationId, open);
  const entries = history.data ?? [];
  const correctedIds = new Set(entries.filter(entry => entry.kind === "reversal").map(entry => entry.correctsMovementId));
  const originalKind = (entry: OutputStockHistoryEntry): string => entry.eventKind ?? (entry.correctsMovementId ? originalKind(entries.find(item => item.id === entry.correctsMovementId) ?? { ...entry, correctsMovementId: null }) : entry.kind);
  const shown = entries.toReversed().filter(entry => !movementId || entry.id === movementId);
  // A correction posts a reversal plus a replacement against the same entry.
  // The replacement carries both, so a lone reversal row would double-count it.
  const foldedIntoReplacement = (entry: OutputStockHistoryEntry) =>
    entry.kind === "reversal" && shown.some(other => other.kind !== "reversal" && other.correctsMovementId === entry.correctsMovementId);
  const timeline = shown.filter(entry => !foldedIntoReplacement(entry));
  return <>
    <Button type="button" variant={compact ? "noOutline" : "default"} className={compact ? "min-h-44 gap-8 px-8 normal-case" : undefined} onClick={() => setOpen(true)}>{compact && <ClockCounterClockwiseIcon size={18} aria-hidden="true" />}<span className={compact ? "body-caption normal-case" : undefined}>{triggerLabel}</span></Button>
    <Modal isOpen={open} onClose={() => { setOpen(false); setOriginal(undefined); }} ariaLabel="Stock history" width="lg">
      <FormDetailProvider scope={`${open}:${original?.id}`} enabled={!!original}>
      <div className="space-y-20">
        <div className="flex items-center justify-between gap-12 pr-24">
          <h3 className="flex min-w-0 items-center gap-6 title-heading-3">
            <span className="truncate">Stock history</span>
            <InfoHint label="About stock history">{HISTORY_HINT}</InfoHint>
          </h3>
          <FormDetailControl />
        </div>
        {original ? <OutputStockForm storageLocationId={storageLocationId} facilityId={facilityId} kind={originalKind(original) === "count" ? "count" : originalKind(original) === "delivery" ? "delivery" : "loss"} original={original} onCancel={() => setOriginal(undefined)} onRecorded={() => setOriginal(undefined)} /> : <>
          {history.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the stock history</p>}
          {history.error && <StockNotice tone="error" role="alert">{history.error.message}</StockNotice>}
          {history.data?.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={32} />} title="No stock history" description="Recorded movements will appear here." padding="sm" />}
          {timeline.length > 0 && <ul>
            {timeline.map((entry, index) => (
              <HistoryEntry
                key={entry.id}
                entry={entry}
                kindLabel={outputStockEventLabel(entry.correctsMovementId && entry.kind !== "reversal" ? "replacement" : entry.kind)}
                reversedEntry={entry.correctsMovementId ? entries.find(item => item.id === entry.correctsMovementId) : undefined}
                reversed={correctedIds.has(entry.id)}
                correctable={entry.kind !== "reversal" && !correctedIds.has(entry.id) && CORRECTABLE_KINDS.includes(originalKind(entry))}
                last={index === timeline.length - 1}
                onCorrect={() => setOriginal(entry)}
              />
            ))}
          </ul>}
        </>}
      </div>
      </FormDetailProvider>
    </Modal>
  </>;
}
