"use client";

/**
 * CreditBatchTimeline: the Overview of /credit-batches. One row per feedstock,
 * one quiet date bar per credit batch (all the same height), year navigation, and
 * a dashed "+" slot in every gap that opens "New credit batch" for that month.
 * Hover (or focus, or a first tap) on a bar shows its facts; pressing a bar
 * opens the batch.
 */
import { useState } from "react";
import { CaretLeftIcon, CaretRightIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { Tooltip } from "@/components/ui/tooltip";
import { useCreditBatchHealthSummaries } from "@/hooks/use-certification";
import { useCreditBatchTimelineFacts } from "@/hooks/use-credit-batches";
import type { CreditBatchWithRelations } from "@/data-access/credit-batches";
import { deriveCreditBatchLifecycle } from "@/lib/certification/credit-batch-lifecycle";
import {
  deriveTimelineState,
  groupByFeedstock,
  dayPercentOfYear,
  monthIndexIn,
  newBatchSlots,
  placeOnYear,
  timelineYears,
  type BarPlacement,
  type DateWindow,
  type TimelineState,
} from "@/lib/credit-batches/timeline";
import { formatDateRange } from "@/lib/format-utils";
import { cn } from "@/lib/utils";
import { BatchHoverCard } from "./credit-batch-timeline-hover-card";
import {
  MonthAxis,
  MonthGrid,
  MUTED,
  STATE_TONE,
  StateLegend,
  TodayLine,
  YearSwitcher,
} from "./credit-batch-timeline-parts";

/** Below this share of the year (about 18 days) a bar has no room for text. */
const NARROW_PCT = 5;
const MIN_TRACK_PX = 880;
/** Batches per timeline request; the server caps one request at 200. */
const MAX_FACT_BATCHES = 200;
const UNNAMED_FEEDSTOCK = "Feedstock not set";

export interface NewBatchRequest extends DateWindow {
  feedstockTypeId: string;
}

interface TimelineBatch extends DateWindow {
  id: string;
  code: string;
  feedstockTypeId: string;
  feedstockTypeName: string | null;
  source: CreditBatchWithRelations;
}

interface BatchView {
  state: TimelineState | null;
  blockingCount: number;
}

/** Opens a scroll box with today in the middle, once per year shown. */
function centerOnToday(year: number, todayPct: number | null) {
  return (box: HTMLDivElement | null) => {
    if (!box || todayPct == null || box.dataset.centeredYear === String(year)) return;
    box.dataset.centeredYear = String(year);
    const track = box.querySelector<HTMLElement>("[data-track]");
    if (!track || box.scrollWidth <= box.clientWidth) return;
    const trackBox = track.getBoundingClientRect();
    const x = trackBox.left - box.getBoundingClientRect().left + box.scrollLeft + (todayPct / 100) * trackBox.width;
    box.scrollLeft = x - box.clientWidth / 2;
  };
}

function CutMark({ side }: { side: "start" | "end" }) {
  const Icon = side === "start" ? CaretLeftIcon : CaretRightIcon;
  return <Icon size={12} className="shrink-0" aria-hidden />;
}

function Bar({ batch, spot, view }: { batch: TimelineBatch; spot: BarPlacement; view: BatchView }) {
  const narrow = spot.width < NARROW_PCT;
  const tone = view.state ? STATE_TONE[view.state] : null;
  return (
    <span className="absolute inset-y-10 left-[1px] right-[1px]">
      <span
        className={cn(
          "absolute inset-0 flex items-center gap-4 overflow-hidden border-l-[3px] pr-4 group-hover:brightness-95",
          narrow ? "justify-center pl-0" : "pl-6",
          tone ? [tone.tint, tone.edge] : "border-[var(--st-off)] bg-[var(--color-surface-light)]",
        )}
      >
        {narrow ? (
          <CutMark side={spot.cutStart ? "start" : "end"} />
        ) : (
          <>
            {spot.cutStart && <CutMark side="start" />}
            {/* Every bar is a credit batch, so the shared "CB-" prefix is dropped; the control's label carries the full code. */}
            <span className="truncate body-caption font-medium tabular-nums">{batch.code.replace(/^CB-/, "")}</span>
            {spot.cutEnd && (
              <span className="ml-auto">
                <CutMark side="end" />
              </span>
            )}
          </>
        )}
      </span>
      {/* The count sits on the corner so the code keeps the bar's width. */}
      {view.blockingCount > 0 && (
        <span
          className="absolute -top-8 -right-4 z-10 inline-flex min-w-20 items-center justify-center rounded-full bg-[var(--st-bad)] px-6 body-caption font-medium tabular-nums text-white"
          aria-hidden
        >
          {view.blockingCount}
        </span>
      )}
    </span>
  );
}

function NewBatchSlot({ slot, spot, onPick }: { slot: DateWindow; spot: BarPlacement; onPick: () => void }) {
  const label = `New credit batch, ${formatDateRange(slot.start, slot.end)}`;
  return (
    <li className="absolute inset-y-0" style={{ left: `${spot.left}%`, width: `${spot.width}%` }}>
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={label}
          onClick={onPick}
          className="absolute inset-x-[2px] inset-y-10 flex items-center justify-center border border-dashed border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)] outline-offset-2 hover:border-[var(--ink)] hover:bg-[var(--color-surface-medium)] hover:text-[var(--color-text-primary)] focus-visible:border-[var(--ink)] focus-visible:text-[var(--color-text-primary)]"
        >
          <PlusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
    </li>
  );
}

export function CreditBatchTimeline({
  batches,
  facilityId,
  today,
  onOpenBatch,
  onNewBatch,
}: {
  batches: CreditBatchWithRelations[];
  facilityId: string;
  /** YYYY-MM-DD. */
  today: string;
  onOpenBatch: (batch: CreditBatchWithRelations) => void;
  onNewBatch: (request: NewBatchRequest) => void;
}) {
  const [year, setYear] = useState(() => Number(today.slice(0, 4)));
  const timelineBatches: TimelineBatch[] = batches.map((batch) => ({
    id: batch.id,
    code: batch.code,
    start: batch.startDate,
    end: batch.endDate,
    feedstockTypeId: batch.feedstockTypeId,
    feedstockTypeName: batch.feedstockTypeName,
    source: batch,
  }));
  const years = timelineYears(timelineBatches, today);
  const rows = groupByFeedstock(timelineBatches, UNNAMED_FEEDSTOCK);
  // Readiness and hover facts load for the shown year only.
  const idsInYear = timelineBatches
    .filter((batch) => placeOnYear(batch, year))
    .map((batch) => batch.id)
    .slice(0, MAX_FACT_BATCHES);
  const { data: summaries = {} } = useCreditBatchHealthSummaries(facilityId, idsInYear);
  const { data: facts = {} } = useCreditBatchTimelineFacts(facilityId, idsInYear);

  const viewOf = (batch: TimelineBatch): BatchView => {
    const summary = summaries[batch.id];
    if (!summary) return { state: null, blockingCount: 0 };
    const lifecycle = deriveCreditBatchLifecycle(summary);
    const state = deriveTimelineState({
      lifecycleStepIndex: lifecycle.currentStepIndex,
      lifecycleFailed: lifecycle.stepStates[lifecycle.currentStepIndex] === "failed",
      healthState: summary.state,
      blockingCount: summary.issueCount,
    });
    // Waiting items never count; a submitted or issued batch shows no count.
    return { state, blockingCount: state === "blocking" ? summary.issueCount : 0 };
  };

  const inYear = timelineBatches.filter((batch) => placeOnYear(batch, year));
  const needWork = inYear.filter((batch) => viewOf(batch).state === "blocking").length;
  const todayPct = monthIndexIn(year, today) >= 0 ? dayPercentOfYear(today) : null;

  return (
    <section
      className="flex min-w-0 flex-col gap-20 border border-[var(--color-border-secondary)] bg-[var(--paper)] p-20 sm:p-24"
      aria-label="Credit batches over time"
    >
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div className="flex flex-col gap-2">
          <YearSwitcher year={year} years={years} today={today} onChange={setYear} />
          <p className={cn("pl-8 body-small", MUTED)}>
            {`${inYear.length} credit ${inYear.length === 1 ? "batch" : "batches"}`}
            {needWork > 0 && `, ${needWork} ${needWork === 1 ? "needs" : "need"} work`}
          </p>
        </div>
        <StateLegend />
      </div>
      {/* Scrolls inside the panel on narrow screens; the page itself never scrolls sideways. */}
      <div ref={centerOnToday(year, todayPct)} className="relative -mx-20 overflow-x-auto px-20 sm:mx-0 sm:px-0">
        <div className="relative" style={{ minWidth: MIN_TRACK_PX }}>
          <div className="grid sm:grid-cols-[128px_minmax(0,1fr)]">
            <span className="hidden sm:block" />
            <MonthAxis year={year} today={today} className="h-24" />
          </div>
          {rows.map((row) => {
            const slots = newBatchSlots(row.batches, today);
            return (
              <div key={row.feedstockTypeId} className="grid border-t border-[var(--color-border-tertiary)] sm:grid-cols-[128px_minmax(0,1fr)]">
                {/* On a phone the name sits above the track and stays in view while the track scrolls. */}
                <div className="sticky left-0 z-30 flex w-fit min-w-0 flex-col justify-center gap-2 bg-[var(--paper)] pt-10 pr-12 sm:w-auto sm:py-10">
                  <span className="body-small font-medium">{row.feedstockName}</span>
                </div>
                <ul data-track className="relative h-[56px]" aria-label={`${row.feedstockName} credit batches in ${year}`}>
                  <MonthGrid year={year} today={today} />
                  {row.batches.map((batch) => {
                    const spot = placeOnYear(batch, year);
                    if (!spot) return null;
                    const view = viewOf(batch);
                    const stateLabel = view.state ? STATE_TONE[view.state].title : "Loading";
                    return (
                      <li key={batch.id}>
                        <div className="absolute inset-y-0" style={{ left: `${spot.left}%`, width: `${spot.width}%` }}>
                          <BatchHoverCard
                            batch={{
                              code: batch.code,
                              feedstockName: row.feedstockName,
                              startDate: batch.start,
                              endDate: batch.end,
                              state: view.state,
                              blockingCount: view.blockingCount,
                              facts: facts[batch.id],
                            }}
                            label={`${batch.code}, ${row.feedstockName}, ${formatDateRange(batch.start, batch.end)}, ${stateLabel}`}
                            className="group absolute inset-0 block outline-offset-2"
                            onOpenBatch={() => onOpenBatch(batch.source)}
                          >
                            <Bar batch={batch} spot={spot} view={view} />
                          </BatchHoverCard>
                        </div>
                      </li>
                    );
                  })}
                  {slots.map((slot) => {
                    const spot = placeOnYear(slot, year);
                    return spot ? (
                      <NewBatchSlot
                        key={slot.start}
                        slot={slot}
                        spot={spot}
                        onPick={() => onNewBatch({ ...slot, feedstockTypeId: row.feedstockTypeId })}
                      />
                    ) : null;
                  })}
                </ul>
              </div>
            );
          })}
          <div className="pointer-events-none absolute top-24 right-0 bottom-0 left-0 sm:left-[128px]">
            <TodayLine year={year} today={today} />
          </div>
        </div>
      </div>
    </section>
  );
}
