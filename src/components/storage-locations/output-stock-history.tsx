"use client";

import { Button } from "@/components/ui";
import { DRY_BIOCHAR_LABEL } from "@/components/biochar-products/product-composition-components";
import { EmptyState } from "@/components/ui/empty-state";
import { FormDialog } from "@/components/ui/form-dialog";
import { Modal } from "@/components/ui/modal";
import { Notice } from "@/components/ui/notice";
import { SecondaryFigure } from "@/components/ui/secondary-figure";
import { InfoHint } from "@/components/ui/tooltip";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputStockBalance, useOutputStockHistory } from "@/hooks/use-output-stock";
import { formatMassKg } from "@/lib/format-utils";
import { LOST_MASS_LABEL, STOCK_HISTORY_HINT, WET_STOCK_DEFINITION } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useState, type ReactNode } from "react";
import { buildHistoryDays, type HistoryDay } from "./output-stock-history-days";
import { HistoryBreak, HistoryEntry, isModeChange } from "./output-stock-history-entry";
import { OutputLossDeleteDialog } from "./loss-delete-dialog";
import { OutputStockForm } from "./output-stock-form";
import { outputStockFigure } from "./stock-preview-shared";

const ICON_PX = 16;

/**
 * A day's heading: the date, and the wet mass when it ended. A day end without a
 * wet figure shows none: a replayed dry balance is not always an honest figure
 * (a history that starts mid-stream replays below zero), unlike the headline's read.
 */
function DayHeader({ day }: { day: HistoryDay }) {
  return (
    <h4 className="flex flex-col gap-2 border-b border-[var(--clr-dark-purple-40)] pb-6 pt-12 body-caption text-[var(--color-text-tertiary)] sm:flex-row sm:justify-between sm:gap-12">
      <span>{day.day}</span>
      {day.end.wetKg !== null && <span className="tabular-nums">{outputStockFigure(day.end.wetKg, day.end.dryKg)} at day end</span>}
    </h4>
  );
}

/** The bin now: wet mass, with the dry biochar under it. */
function Headline({ wetKg, dryKg }: { wetKg: number | null; dryKg: number }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-6 body-large font-medium tabular-nums">
        {outputStockFigure(wetKg, dryKg)}
        {wetKg !== null && <InfoHint label="About wet mass">{WET_STOCK_DEFINITION}</InfoHint>}
      </p>
      {wetKg !== null && <SecondaryFigure label={DRY_BIOCHAR_LABEL} value={formatMassKg(dryKg)} />}
    </div>
  );
}

export function OutputStockHistory({ storageLocationId, facilityId, movementId, triggerLabel = "More info", compact = false, renderTrigger, readOnly = false, balance: linkedBalance, timeZone }: {
  storageLocationId: string;
  facilityId: string;
  movementId?: string;
  triggerLabel?: string;
  compact?: boolean;
  /** Draws the opener in the caller's own style, given the history icon. */
  renderTrigger?: (open: () => void, icon: ReactNode) => ReactNode;
  /** Hides Lost mass Edit and Delete on a read-only bin; the history stays visible. */
  readOnly?: boolean;
  /** The bin now, already read by the card: a read-only bin cannot use the active-only balance read. */
  balance?: { beforeEstimatedWetKg: number | null; beforeDryKg: number };
  /** The record's own zone when its facility is archived and outside the facility list. */
  timeZone?: string;
}) {
  const { timeZone: zone } = useFacilityClock(facilityId, { timeZone });
  const [open, setOpen] = useState(false);
  const historyTitleId = useId();
  const lostMassTitleId = useId();
  const [editing, setEditing] = useState<OutputStockHistoryEntry | null>(null);
  const [deleting, setDeleting] = useState<OutputStockHistoryEntry | null>(null);
  const history = useOutputStockHistory(storageLocationId, open);
  // The bin now, as its stock card reads it; one movement opened on its own needs no headline.
  const liveBalance = useOutputStockBalance(!readOnly && open && !movementId ? { storageLocationId, facilityId } : null);
  const entries = history.data ?? [];
  const days = buildHistoryDays(entries, zone, movementId);
  const now = readOnly ? (movementId ? undefined : linkedBalance) : liveBalance.data;
  const openHistory = () => setOpen(true);
  const icon = <ClockCounterClockwiseIcon size={compact ? 18 : ICON_PX} aria-hidden="true" />;

  return <>
    {renderTrigger ? renderTrigger(openHistory, icon) : (
      <Button type="button" variant={compact ? "noOutline" : "default"} className={compact ? "min-h-44 gap-8 px-8 normal-case" : undefined} onClick={openHistory}>{compact && icon}<span className={compact ? "body-caption normal-case" : undefined}>{triggerLabel}</span></Button>
    )}
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Stock history" titleId={historyTitleId} width="lg">
      <div className="flex flex-col gap-20">
        <div className="flex items-center justify-between gap-12">
          <h3 id={historyTitleId} className="flex min-w-0 items-center gap-6 title-heading-3">
            <span className="truncate">Stock history</span>
            <InfoHint label="About stock history">{STOCK_HISTORY_HINT}</InfoHint>
          </h3>
        </div>
        {now && history.data && history.data.length > 0 && (
          <Headline wetKg={now.beforeEstimatedWetKg} dryKg={now.beforeDryKg} />
        )}
        {history.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the stock history</p>}
        {history.error && <Notice tone="error">{history.error.message}</Notice>}
        {history.data?.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={32} />} title="No stock history" description="Recorded movements will appear here." padding="sm" />}
        {days.length > 0 && <div className="flex flex-col">
          {days.map((day) => (
            <section key={day.day} aria-label={day.day} className="flex flex-col">
              <DayHeader day={day} />
              {day.rows.map((row) => isModeChange(row.entry) || row.entry.kind === "moisture_update"
                ? <HistoryBreak key={row.entry.id} entry={row.entry} timeZone={zone} facilityId={facilityId} />
                : <HistoryEntry key={row.entry.id} row={row} defaultOpen={!!movementId} linked={!movementId} timeZone={zone} facilityId={facilityId} onEdit={readOnly ? undefined : setEditing} onDelete={readOnly ? undefined : setDeleting} />)}
            </section>
          ))}
        </div>}
      </div>
    </Modal>
    <FormDialog isOpen={editing !== null} onClose={() => setEditing(null)} ariaLabel="Edit lost mass" titleId={lostMassTitleId} width="md">
      <h3 id={lostMassTitleId} className="title-heading-3 mb-20">{LOST_MASS_LABEL}</h3>
      {editing && <OutputStockForm key={editing.id} storageLocationId={storageLocationId} facilityId={facilityId} correction={editing}
        onCancel={() => setEditing(null)} onRecorded={() => setEditing(null)} />}
    </FormDialog>
    {deleting && <OutputLossDeleteDialog key={deleting.id} entry={deleting} storageLocationId={storageLocationId} timeZone={zone} onClose={() => setDeleting(null)} />}
  </>;
}
