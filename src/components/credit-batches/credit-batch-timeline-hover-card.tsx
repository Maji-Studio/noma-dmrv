"use client";

/**
 * The hover card of a credit batch bar. Base UI PreviewCard: it opens on hover
 * and on keyboard focus of the bar, and on a first tap on touch screens (the
 * second tap opens the batch). The bar itself is the control that opens the
 * batch, so the card carries facts only, no link.
 * Elevated surface per the design system: paper, full-ink border, no shadow.
 */
import { useState, type ReactNode } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { CalendarBlankIcon, LeafIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { StatusBadge, type StatusValue } from "@/components/ui/status-badge";
import type { CreditBatchTimelineFacts } from "@/data-access/credit-batch-timeline-facts";
import { formatDateRange, formatTonnes } from "@/lib/format-utils";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { MISSING_VALUE } from "@/lib/copy-utils";
import type { TimelineState } from "@/lib/credit-batches/timeline";
import { cn } from "@/lib/utils";
import { MUTED, STATE_TONE } from "./credit-batch-timeline-parts";

const OPEN_DELAY_MS = 200;
const CLOSE_DELAY_MS = 120;
const SIDE_OFFSET_PX = 8;
/** Base UI's own close when a trigger is pressed; the tap handler owns presses. */
const TRIGGER_PRESS = "trigger-press";
/** A touch tap also fires a synthetic mouse leave; these closes must not undo it. */
const POINTER_CLOSE_REASONS = new Set(["trigger-hover", "trigger-focus"]);
/** Tonnes below this read as zero in the "not in a Removal" line. */
const NEGLIGIBLE_TONNES = 0.005;

/** The badge's status; its colors come from the timeline's own tone (STATE_TONE). */
const STATE_BADGE: Record<TimelineState, StatusValue> = {
  blocking: "pending",
  ready: "running",
  submitted: "complete",
  issued: "issued",
};

export interface HoverCardBatch {
  code: string;
  feedstockName: string;
  startDate: string;
  endDate: string;
  state: TimelineState | null;
  blockingCount: number;
  facts: CreditBatchTimelineFacts | undefined;
  /** Whether `facts` is still loading or could not be loaded, so a gap is not read as a missing measurement. */
  factsStatus: "loading" | "failed" | "ready";
}

function tonnesOrMissing(kg: number | null | undefined, status: HoverCardBatch["factsStatus"]): string {
  if (status === "loading") return "Loading";
  if (status === "failed") return MISSING_VALUE.notAvailable;
  return kg == null ? MISSING_VALUE.notAvailable : formatTonnes(kgToTonnes(kg));
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-2">
      <dt className={cn("body-caption", MUTED)}>{label}</dt>
      <dd className="body-large tabular-nums">{value}</dd>
    </div>
  );
}

function HoverCardBody({ batch }: { batch: HoverCardBatch }) {
  const { facts, state } = batch;
  const notInRemoval = facts ? kgToTonnes(facts.notInRemovalDryKg) : 0;
  return (
    <div className="flex w-[300px] max-w-[calc(100vw-32px)] flex-col">
      <div className="flex flex-col gap-10 px-16 pt-16 pb-12">
        <div className="flex items-center justify-between gap-12">
          <span className="body-medium font-medium tabular-nums">{batch.code}</span>
          {state && <StatusBadge status={STATE_BADGE[state]} label={STATE_TONE[state].title} size="small" className={STATE_TONE[state].badge} />}
        </div>
        <div className={cn("flex flex-col gap-4 body-small", MUTED)}>
          <span className="inline-flex items-center gap-6">
            <LeafIcon size={16} aria-hidden />
            {batch.feedstockName}
          </span>
          <span className="inline-flex items-center gap-6">
            <CalendarBlankIcon size={16} aria-hidden />
            {formatDateRange(batch.startDate, batch.endDate)}
          </span>
        </div>
      </div>
      {batch.blockingCount > 0 && (
        <div className={cn("flex items-center gap-8 px-16 py-8 body-small font-medium", STATE_TONE.blocking.tint)}>
          <WarningCircleIcon size={16} weight="fill" className={cn("shrink-0", STATE_TONE.blocking.text)} aria-hidden />
          {`Missing data ${batch.blockingCount}`}
        </div>
      )}
      <dl className="grid grid-cols-2 gap-12 border-t border-[var(--color-border-tertiary)] px-16 py-12">
        <Figure label="Produced (dry)" value={tonnesOrMissing(facts?.producedDryKg, batch.factsStatus)} />
        <Figure label="Applied (dry)" value={tonnesOrMissing(facts?.appliedDryKg, batch.factsStatus)} />
      </dl>
      {facts && notInRemoval > NEGLIGIBLE_TONNES && (
        <p className={cn("border-t border-[var(--color-border-tertiary)] px-16 py-10 body-small", MUTED)}>
          {`${formatTonnes(notInRemoval)} not in a Removal`}
        </p>
      )}
      {facts && facts.removalCodes.length > 0 && (
        <p className={cn("border-t border-[var(--color-border-tertiary)] px-16 py-10 body-small", MUTED)}>
          {`${facts.removalCodes.length === 1 ? "Removal" : "Removals"}: ${facts.removalCodes.join(", ")}`}
        </p>
      )}
    </div>
  );
}

/** The bar's control, with the hover card. `children` draws the bar. */
export function BatchHoverCard({
  batch,
  label,
  className,
  onOpenBatch,
  children,
}: {
  batch: HoverCardBatch;
  label: string;
  className?: string;
  onOpenBatch: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Opened by a tap: stays open until an outside press, Escape or the second tap.
  const [pinned, setPinned] = useState(false);
  return (
    <PreviewCard.Root
      open={open}
      onOpenChange={(next, details) => {
        if (details.reason === TRIGGER_PRESS) return;
        if (!next && pinned && POINTER_CLOSE_REASONS.has(details.reason)) return;
        if (!next) setPinned(false);
        setOpen(next);
      }}
    >
      <PreviewCard.Trigger
        delay={OPEN_DELAY_MS}
        closeDelay={CLOSE_DELAY_MS}
        render={
          <button
            type="button"
            aria-label={label}
            className={className}
            onClick={(event) => {
              // A first touch tap shows the card; the next one opens the batch.
              const pointerType = (event.nativeEvent as PointerEvent).pointerType;
              if (pointerType === "touch" && !open) {
                setPinned(true);
                setOpen(true);
                return;
              }
              setPinned(false);
              setOpen(false);
              onOpenBatch();
            }}
          />
        }
      >
        {children}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={SIDE_OFFSET_PX} className="z-[var(--z-layer-popover)]">
          <PreviewCard.Popup className="border border-[var(--ink)] bg-[var(--paper)] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <HoverCardBody batch={batch} />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
