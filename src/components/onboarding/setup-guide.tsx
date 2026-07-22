/**
 * SetupGuide — the getting-started guide (Surface 2), the dashboard body while
 * Phase-1 setup is incomplete. A quiet, brutalist panel wrapping the one bold
 * element: the traceability spine. It computes and self-clears from record
 * existence, and can be collapsed to a strip per user.
 */
"use client";

import { EyeSlashIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import type { SetupProgress } from "./use-setup-steps";
import { SetupSpine } from "./setup-spine";

interface SetupGuideProps {
  progress: SetupProgress;
  /** Reopen the first-run wizard from the facility step (no facility yet). */
  onStartFacility: () => void;
  onCollapse: () => void;
}

export function SetupGuide({
  progress,
  onStartFacility,
  onCollapse,
}: SetupGuideProps) {
  const { steps, doneCount, total, activeIndex } = progress;

  return (
    <section
      aria-label="Getting started"
      className="flex flex-col gap-24 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-24"
    >
      <header className="flex flex-wrap items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-6">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            Setup
          </span>
          <h2 className="title-heading-3">
            Build your first traceability chain
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            Work down the chain, from your facility to a verified credit batch.
            You can finish these steps at your own pace.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-12">
          <span className="label-micro text-[var(--color-text-tertiary)]">
            {doneCount} of {total} done
          </span>
          <Button
            variant="noOutline"
            size="icon"
            aria-label="Hide setup guide"
            onClick={onCollapse}
          >
            <EyeSlashIcon size={20} weight="bold" />
          </Button>
        </div>
      </header>

      <SetupSpine
        steps={steps}
        activeIndex={activeIndex}
        onStartFacility={onStartFacility}
      />
    </section>
  );
}
