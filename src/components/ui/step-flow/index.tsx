/**
 * StepFlow — minimal stepped-flow chrome (step rail + content slot + footer
 * action bar). Deliberately "dumb": the parent owns the active index, per-step
 * validation (by gating its own Next button), and the step content. StepFlow
 * only renders the rail, the current step's body, and a pinned footer.
 *
 * Two orientations:
 *  - `horizontal` (default) — a numbered rail across the top, for full-width
 *    routes (the removal Review flow).
 *  - `vertical` — a compact rail down the side, for narrow surfaces (the GHG
 *    statement create dialog, Stage 5).
 *
 * Visited steps (index ≤ `furthest`) are clickable when `onNavigate` is given,
 * so the operator can jump back without losing progress.
 */
"use client";

import * as React from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/ssr";
import { cn } from "@/lib/utils";

export interface StepFlowStep {
  key: string;
  label: string;
  /** Optional one-line helper, shown under the label in the vertical rail. */
  description?: string;
}

interface StepFlowProps {
  steps: StepFlowStep[];
  /** Zero-based index of the active step. */
  current: number;
  /**
   * Furthest step the operator has reached — steps up to here are navigable.
   * Defaults to `current` (only the path already walked is clickable).
   */
  furthest?: number;
  /** Jump to a visited step via the rail. Omit to make the rail display-only. */
  onNavigate?: (index: number) => void;
  /** The active step's content. */
  children: React.ReactNode;
  /** Action row pinned below the content (Back / Next / Submit). */
  footer?: React.ReactNode;
  orientation?: "horizontal" | "vertical";
  className?: string;
}

type StepState = "done" | "active" | "upcoming";

function stepState(index: number, current: number): StepState {
  if (index < current) return "done";
  if (index === current) return "active";
  return "upcoming";
}

function StepIndex({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-24 w-24 shrink-0 items-center justify-center border body-caption-fit font-medium transition-colors",
        state === "done" &&
          "border-[var(--clr-pink)] bg-[var(--clr-pink)] text-white",
        state === "active" &&
          "border-[var(--clr-pink)] text-[var(--clr-pink)]",
        state === "upcoming" &&
          "border-[var(--color-border-secondary)] text-[var(--color-text-tertiary)]",
      )}
    >
      {state === "done" ? <CheckIcon size={14} weight="bold" /> : n}
    </span>
  );
}

function RailItem({
  step,
  index,
  current,
  navigable,
  onNavigate,
  orientation,
}: {
  step: StepFlowStep;
  index: number;
  current: number;
  navigable: boolean;
  onNavigate?: (index: number) => void;
  orientation: "horizontal" | "vertical";
}) {
  const state = stepState(index, current);
  const labelClass = cn(
    "body-small transition-colors",
    orientation === "horizontal" ? "whitespace-nowrap" : "truncate",
    state === "active"
      ? "text-[var(--color-text-primary)]"
      : "text-[var(--color-text-tertiary)]",
  );

  const inner = (
    <span
      className={cn(
        "flex items-center gap-8",
        orientation === "horizontal" ? "min-w-0" : "min-w-0 flex-1",
      )}
    >
      <StepIndex state={state} n={index + 1} />
      <span className="flex min-w-0 flex-col">
        <span className={labelClass}>{step.label}</span>
        {orientation === "vertical" && step.description && (
          <span className="body-caption truncate text-[var(--color-text-tertiary)]">
            {step.description}
          </span>
        )}
      </span>
    </span>
  );

  if (navigable && onNavigate) {
    return (
      <button
        type="button"
        onClick={() => onNavigate(index)}
        aria-current={state === "active" ? "step" : undefined}
        className="flex min-w-0 items-center text-left transition-opacity hover:opacity-70"
      >
        {inner}
      </button>
    );
  }
  return (
    <span
      aria-current={state === "active" ? "step" : undefined}
      className="flex min-w-0 items-center"
    >
      {inner}
    </span>
  );
}

export function StepFlow({
  steps,
  current,
  furthest,
  onNavigate,
  children,
  footer,
  orientation = "horizontal",
  className,
}: StepFlowProps) {
  const reach = furthest ?? current;

  const rail = (
    <ol
      className={cn(
        orientation === "horizontal"
          ? "flex items-center gap-8 overflow-x-auto"
          : "flex flex-col gap-12",
      )}
    >
      {steps.map((step, index) => {
        const navigable = !!onNavigate && index <= reach;
        return (
          <li
            key={step.key}
            className={cn(
              "flex min-w-0 items-center",
              orientation === "horizontal" && "shrink-0 gap-8",
            )}
          >
            <RailItem
              step={step}
              index={index}
              current={current}
              navigable={navigable}
              onNavigate={onNavigate}
              orientation={orientation}
            />
            {orientation === "horizontal" && index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-24 shrink-0 sm:w-40",
                  index < current
                    ? "bg-[var(--clr-pink)]"
                    : "bg-[var(--color-border-secondary)]",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );

  if (orientation === "vertical") {
    return (
      <div className={cn("flex flex-col gap-24 sm:flex-row", className)}>
        <nav
          aria-label="Steps"
          className="shrink-0 border-b border-[var(--color-border-secondary)] pb-16 sm:w-[200px] sm:border-b-0 sm:border-r sm:pb-0 sm:pr-24"
        >
          {rail}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-24">
          <div className="flex flex-col">{children}</div>
          {footer && <div className="mt-auto">{footer}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-24", className)}>
      <nav
        aria-label="Steps"
        className="border-b border-[var(--color-border-secondary)] pb-16"
      >
        {rail}
      </nav>
      <div className="flex flex-col">{children}</div>
      {footer && (
        <div className="border-t border-[var(--color-border-secondary)] pt-16">
          {footer}
        </div>
      )}
    </div>
  );
}
