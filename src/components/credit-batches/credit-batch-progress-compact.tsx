"use client";

/**
 * The credit batch progress on a phone: one row naming the step the batch is
 * at, with a tiny four-segment bar and "Step 1 of 4". A press opens the shared
 * `Popover` with all four milestones, their state and captions. The four
 * milestones are read-only status, not actions, so this is a popover and not
 * a `DropdownMenu`, whose items would announce as menu commands.
 */
import { CaretDownIcon, CheckIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Popover } from "@/components/ui/popover";
import type { CreditBatchMilestone } from "@/lib/credit-batches/batch-page";
import { cn } from "@/lib/utils";
import { CountBadge, FOCUS_RING, MUTED_TEXT } from "./credit-batch-page-parts";

export const CREDIT_BATCH_PROGRESS_TITLE = "Credit batch progress";

const STATE_ICON_PX = 16;
const CARET_PX = 16;

/** The mini bar's segment fill per state, matching the desktop stepper's bars. */
const SEGMENT: Record<CreditBatchMilestone["state"], string> = {
  done: "bg-[var(--st-ok)]",
  current: "bg-[var(--ink)]",
  failed: "bg-[var(--st-bad)]",
  todo: "bg-[var(--color-border-tertiary)]",
};

const STATE_TEXT: Record<CreditBatchMilestone["state"], string> = {
  done: "done",
  current: "current step",
  failed: "needs attention",
  todo: "not started",
};

/**
 * The step the row names: the current or failed one; once every step is done,
 * the last; before anything starts, the first.
 */
export function progressFocusIndex(steps: readonly CreditBatchMilestone[]): number {
  const active = steps.findIndex((step) => step.state === "current" || step.state === "failed");
  if (active >= 0) return active;
  const lastDone = steps.findLastIndex((step) => step.state === "done");
  return lastDone >= 0 ? lastDone : 0;
}

function blockingLabel(count: number): string {
  return `${count} blocking ${count === 1 ? "item" : "items"}`;
}

/** A 16px marker per state: a check, a warning, a filled dot for now, a hollow one for later. */
function StateMarker({ state }: { state: CreditBatchMilestone["state"] }) {
  if (state === "done") return <CheckIcon size={STATE_ICON_PX} weight="bold" className="shrink-0 text-[var(--st-ok)]" aria-hidden />;
  if (state === "failed") return <WarningCircleIcon size={STATE_ICON_PX} weight="bold" className="shrink-0 text-[var(--st-bad)]" aria-hidden />;
  return (
    <span aria-hidden className="flex size-16 shrink-0 items-center justify-center">
      <span
        className={cn(
          "size-8 rounded-full border",
          state === "current" ? "border-[var(--ink)] bg-[var(--ink)]" : "border-[var(--color-border-primary)]",
        )}
      />
    </span>
  );
}

function StepTitle({ step }: { step: CreditBatchMilestone }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-6 body-small", step.state === "todo" ? MUTED_TEXT : "font-medium")}>
      {step.label}
      {step.count != null && <CountBadge count={step.count} blocking label={blockingLabel(step.count)} />}
    </span>
  );
}

export function CreditBatchProgressCompact({ steps, className }: { steps: CreditBatchMilestone[]; className?: string }) {
  const index = progressFocusIndex(steps);
  const focus = steps[index];
  if (!focus) return null;
  const trigger = (
    <button
      type="button"
      data-testid="credit-batch-progress-trigger"
      className={cn(
        "flex min-h-44 w-full items-center gap-12 border border-[var(--color-border-secondary)] bg-[var(--paper)] px-12 py-8 text-left",
        "hover:border-[var(--color-border-primary)] data-[popup-open]:border-[var(--color-border-primary)]",
        FOCUS_RING,
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-4">
        <span className="inline-flex items-center gap-6">
          <StateMarker state={focus.state} />
          <StepTitle step={focus} />
        </span>
        <span className={cn("inline-flex items-center gap-8 body-caption", MUTED_TEXT)}>
          <span aria-hidden className="inline-flex gap-2">
            {steps.map((step) => (
              <span key={step.key} className={cn("h-4 w-12", SEGMENT[step.state])} />
            ))}
          </span>
          {`Step ${index + 1} of ${steps.length}`}
        </span>
      </span>
      <CaretDownIcon size={CARET_PX} weight="bold" aria-hidden className={cn("shrink-0", MUTED_TEXT)} />
    </button>
  );
  return (
    <div className={className}>
      {/* As wide as the row that opened it. */}
      <Popover trigger={trigger} title={CREDIT_BATCH_PROGRESS_TITLE} className="w-[var(--anchor-width)]">
        <ol className="flex flex-col gap-12" aria-label={CREDIT_BATCH_PROGRESS_TITLE}>
          {steps.map((step) => (
            <li
              key={step.key}
              aria-current={step.state === "current" ? "step" : undefined}
              className="grid grid-cols-[16px_minmax(0,1fr)] items-start gap-x-8"
            >
              <span className="pt-2"><StateMarker state={step.state} /></span>
              <span className="flex min-w-0 flex-col gap-2">
                <StepTitle step={step} />
                <span className="sr-only">{STATE_TEXT[step.state]}</span>
                {step.caption && (
                  <span className={cn("body-caption", step.state === "failed" ? "text-[var(--st-bad)]" : MUTED_TEXT)}>{step.caption}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </Popover>
    </div>
  );
}
