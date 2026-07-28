/**
 * The compiled registry payload, demoted to what it actually is: a debug
 * drawer. Closed by default and never a peer of the submission summary — the
 * operator only opens it when the submission fails to build.
 */
"use client";

import { Accordion } from "@/components/ui/accordion";
import type { RemovalCompilationView } from "@/fn/certification";
import { CompiledSubmissionReview } from "./compiled-submission-review";

const ACCORDION_ITEM =
  "rounded-none border-[var(--color-border-secondary)] bg-[var(--color-background-white)]";
const ACCORDION_TRIGGER =
  "bg-[var(--color-background-white)] px-16 py-10 hover:bg-[var(--color-surface-light)]";

interface DebugDrawerProps {
  compilation: RemovalCompilationView | null;
  isCompilationLoading: boolean;
  compilationError: Error | null;
  onRetryCompilation: () => void;
}

export function DebugDrawer({
  compilation,
  isCompilationLoading,
  compilationError,
  onRetryCompilation,
}: DebugDrawerProps) {
  return (
    <Accordion.Root className="gap-0" defaultValue={[]}>
      <Accordion.Item value="debug" className={ACCORDION_ITEM}>
        <Accordion.Header>
          <Accordion.Trigger
            className={ACCORDION_TRIGGER}
            labelClassName="label-micro text-[var(--color-text-tertiary)]"
          >
            <span className="flex w-full items-center justify-between gap-12">
              <span>Debug</span>
              <span className="body-caption font-normal normal-case tracking-normal text-[var(--color-text-tertiary)]">
                Compiled registry payload
              </span>
            </span>
          </Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel className="[&>div]:p-0">
          <div className="border-t border-[var(--color-border-tertiary)]">
            <CompiledSubmissionReview
              compilation={compilation}
              isLoading={isCompilationLoading}
              error={compilationError}
              onRetry={onRetryCompilation}
            />
          </div>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  );
}
