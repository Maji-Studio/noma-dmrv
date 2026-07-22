/**
 * SetupStrip — the collapsed getting-started guide. A slim link-chain summary
 * that keeps setup one click away while the real dashboard renders below.
 * Hidden is not done: the strip persists until every step is satisfied.
 */
"use client";

import { EyeIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import type { SetupProgress } from "./use-setup-steps";

interface SetupStripProps {
  progress: SetupProgress;
  onExpand: () => void;
}

export function SetupStrip({ progress, onExpand }: SetupStripProps) {
  const { steps, doneCount, total } = progress;

  return (
    <section
      aria-label="Getting started"
      className="flex flex-wrap items-center justify-between gap-16 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-20 py-12"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-12 gap-y-8">
        <span className="label-micro text-[var(--color-text-tertiary)]">
          Setup · {doneCount}/{total}
        </span>
        <ol className="flex flex-wrap items-center gap-x-8 gap-y-4">
          {steps.map((step) => (
            <li
              key={step.id}
              className={[
                "body-caption",
                step.done
                  ? "text-[var(--color-text-tertiary)] line-through"
                  : "text-[var(--color-text-secondary)]",
              ].join(" ")}
            >
              {step.shortLabel}
            </li>
          ))}
        </ol>
      </div>
      <Button variant="weak" size="small" onClick={onExpand}>
        <EyeIcon size={16} weight="bold" />
        Show guide
      </Button>
    </section>
  );
}
