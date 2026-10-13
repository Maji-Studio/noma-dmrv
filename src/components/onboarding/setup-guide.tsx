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
import type { SetupActions } from "./setup-actions";
import { SetupSpine } from "./setup-spine";

interface SetupGuideProps {
  progress: SetupProgress;
  actions: SetupActions;
  onCollapse: () => void;
}

export function SetupGuide({
  progress,
  actions,
  onCollapse,
}: SetupGuideProps) {
  const { steps, doneCount, total, activeIndex } = progress;
  const hasFacility = steps.some((step) => step.id === "facility" && step.done);

  return (
    <section
      aria-label="Getting started"
      className="flex flex-col gap-24 border border-[var(--color-border-primary)] bg-[var(--color-background-white)] p-24"
    >
      <header className="flex flex-wrap items-start justify-between gap-16">
        <div className="flex min-w-0 flex-col gap-6">
          <h2 className="title-heading-3">
            Build your first traceability chain
          </h2>
          <p className="body-small text-[var(--color-text-secondary)]">
            A few steps to get your facility producing verified carbon removals.
            Start with your facility, reactor and registry connection. Suppliers,
            feedstock, production runs and credit batches can wait until you&apos;re ready.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-12">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            {doneCount} of {total} done
          </span>
          {hasFacility && <Button
            variant="noOutline"
            size="icon"
            aria-label="Hide setup guide"
            onClick={onCollapse}
          >
            <EyeSlashIcon size={20} weight="bold" />
          </Button>}
        </div>
      </header>

      <SetupSpine
        steps={steps}
        activeIndex={activeIndex}
        actions={actions}
      />
    </section>
  );
}
