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
import { createIntentHref } from "@/lib/create-intent";
import { formatMassKg } from "@/lib/format-utils";
import { LOST_MASS_LABEL, WET_STOCK_DEFINITION } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { buildHistoryDays, noWetMassReason, type HistoryDay } from "./output-stock-history-days";
import { HistoryBreak, HistoryEntry, isModeChange } from "./output-stock-history-entry";
import { OutputStockForm } from "./output-stock-form";
import { formatWetEstimate } from "./stock-preview-shared";

const ICON_PX = 16;
/** Where each kind of output bin gets its stock: products go into product bins, runs into biochar bins. */
const ADD_STOCK_PATHS = { product: "/biochar-products", biochar: "/production-runs" } as const;

/** The one fact the entries cannot show as a figure. */
const HISTORY_HINT =
  "Each entry is one measurement. Wet stock is wet mass added less wet mass taken out. A later entry never changes an earlier one.";

function wetFigure(wetKg: number): string {
  return `${formatWetEstimate(wetKg)} kg wet mass`;
}

/** A day's heading: the date, and the stock when it ended (wet mass, or the dry biochar without one). */
function DayHeader({ day }: { day: HistoryDay }) {
  return (
    <h4 className="flex flex-col gap-2 border-b border-[var(--clr-dark-purple-40)] pb-6 pt-12 body-caption text-[var(--color-text-tertiary)] sm:flex-row sm:justify-between sm:gap-12">
      <span>{day.day}</span>
      <span className="tabular-nums">{day.end.wetKg === null ? `${formatMassKg(day.end.dryKg)} dry biochar` : wetFigure(day.end.wetKg)} at day end</span>
    </h4>
  );
}

/**
 * The bin now: wet mass, with the dry biochar under it. Without a wet figure
 * the dry biochar leads, with the one reason there is none and where to fix it.
 */
function Headline({ wetKg, dryKg, entries, addStockHref }: { wetKg: number | null; dryKg: number; entries: readonly OutputStockHistoryEntry[]; addStockHref: string }) {
  const reason = wetKg === null ? noWetMassReason(entries) : null;
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-6 body-large font-medium tabular-nums">
        {wetKg === null ? `${formatMassKg(dryKg)} dry biochar` : wetFigure(wetKg)}
        {wetKg !== null && <InfoHint label="About wet mass">{WET_STOCK_DEFINITION}</InfoHint>}
      </p>
      {reason
        ? <p className="body-caption text-[var(--color-text-secondary)]">{reason.lead}<Link href={addStockHref} className="underline underline-offset-4">{reason.action}</Link>.</p>
        : <SecondaryFigure label={DRY_BIOCHAR_LABEL} value={formatMassKg(dryKg)} />}
    </div>
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
  // The bin now, as its stock card reads it; one movement opened on its own needs no headline.
  const balance = useOutputStockBalance(open && !movementId ? { storageLocationId, facilityId } : null);
  const entries = history.data ?? [];
  const days = buildHistoryDays(entries, clock.timeZone, movementId);
  const now = balance.data;
  const openHistory = () => setOpen(true);
  const icon = <ClockCounterClockwiseIcon size={compact ? 18 : ICON_PX} aria-hidden="true" />;

  return <>
    {renderTrigger ? renderTrigger(openHistory, icon) : (
      <Button type="button" variant={compact ? "noOutline" : "default"} className={compact ? "min-h-44 gap-8 px-8 normal-case" : undefined} onClick={openHistory}>{compact && icon}<span className={compact ? "body-caption normal-case" : undefined}>{triggerLabel}</span></Button>
    )}
    <Modal isOpen={open} onClose={() => setOpen(false)} ariaLabel="Stock history" width="lg">
      <div className="flex flex-col gap-20">
        <div className="flex items-center justify-between gap-12 pr-24">
          <h3 className="flex min-w-0 items-center gap-6 title-heading-3">
            <span className="truncate">Stock history</span>
            <InfoHint label="About stock history">{HISTORY_HINT}</InfoHint>
          </h3>
        </div>
        {now && history.data && history.data.length > 0 && (
          <Headline wetKg={now.beforeEstimatedWetKg} dryKg={now.beforeDryKg} entries={entries}
            addStockHref={createIntentHref(ADD_STOCK_PATHS[now.lane === "biochar" ? "biochar" : "product"], facilityId)} />
        )}
        {history.isLoading && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Loading the stock history</p>}
        {history.error && <Notice tone="error">{history.error.message}</Notice>}
        {history.data?.length === 0 && <EmptyState icon={<ClockCounterClockwiseIcon size={32} />} title="No stock history" description="Recorded movements will appear here." padding="sm" />}
        {days.length > 0 && <div className="flex flex-col">
          {days.map((day) => (
            <section key={day.day} aria-label={day.day} className="flex flex-col">
              <DayHeader day={day} />
              {day.rows.map((row) => isModeChange(row.entry) || row.entry.kind === "moisture_update"
                ? <HistoryBreak key={row.entry.id} entry={row.entry} timeZone={clock.timeZone} facilityId={facilityId} />
                : <HistoryEntry key={row.entry.id} row={row} defaultOpen={!!movementId} timeZone={clock.timeZone} facilityId={facilityId} onEdit={setEditing} />)}
            </section>
          ))}
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
