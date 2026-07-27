"use client";

import { useId, useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import {
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { RemovalCompilationView } from "@/fn/certification";
import type { RemovalRequirementCheck } from "@/lib/certification/readiness";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import { Button } from "@/components/ui";
import { EnvBanner } from "../env-banner";
import { CompilationBlockers, CompilationWarnings } from "./compilation-notices";
import { CompiledSubmissionReview } from "./compiled-submission-review";
import { SubmissionChecks } from "./submission-checks";
import { SubmissionOverview } from "./submission-overview";

const REVIEW_TAB = "review";
const TECHNICAL_TAB = "technical";
const INCOMPLETE_ARTIFACT_BLOCKER =
  "The compiler did not produce a complete submission artifact.";

type ReviewTab = typeof REVIEW_TAB | typeof TECHNICAL_TAB;

interface SubmissionReviewTabsProps {
  memberBatches: MemberCreditBatch[];
  facilityId: string;
  compilation: RemovalCompilationView | null;
  isCompilationLoading: boolean;
  compilationError: Error | null;
  onRetryCompilation: () => void;
  checks: RemovalRequirementCheck[];
  isProduction: boolean;
}

interface CompilationStatusProps {
  compilation: RemovalCompilationView | null;
  isLoading: boolean;
  error: Error | null;
  onOpenTechnicalDetails: () => void;
}

export function isRemovalCompilationReady(
  compilation: RemovalCompilationView | null,
): boolean {
  return (
    compilation?.blockers.length === 0 &&
    compilation.snapshot !== null &&
    compilation.compilationHash !== null
  );
}

function CompilationStatus({
  compilation,
  isLoading,
  error,
  onOpenTechnicalDetails,
}: CompilationStatusProps) {
  const headingId = useId();

  if (isLoading) {
    return (
      <section
        className="flex items-start gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-12"
        aria-labelledby={headingId}
        aria-live="polite"
      >
        <SpinnerGapIcon
          size={20}
          weight="bold"
          aria-hidden
          className="mt-2 shrink-0 text-[var(--st-run)]"
        />
        <div className="flex flex-col gap-2">
          <h4
            id={headingId}
            className="body-small font-medium text-[var(--color-text-primary)]"
          >
            Compilation in progress
          </h4>
          <p className="body-caption text-[var(--color-text-secondary)]">
            Preparing the Isometric submission for review.
          </p>
        </div>
      </section>
    );
  }

  if (error || !compilation) {
    return (
      <section
        className="flex flex-wrap items-center justify-between gap-12 border border-[var(--st-bad)] bg-[var(--st-bad-bg)] px-16 py-12"
        aria-labelledby={headingId}
        role="alert"
      >
        <div className="flex items-start gap-12">
          <WarningIcon
            size={20}
            weight="fill"
            aria-hidden
            className="mt-2 shrink-0 text-[var(--st-bad)]"
          />
          <div className="flex flex-col gap-2">
            <h4
              id={headingId}
              className="body-small font-medium text-[var(--color-text-primary)]"
            >
              Compilation unavailable
            </h4>
            <p className="body-caption text-[var(--color-text-secondary)]">
              Nothing can be submitted until the technical review compiles
              successfully.
            </p>
          </div>
        </div>
        <Button variant="weak" size="small" onClick={onOpenTechnicalDetails}>
          Open technical details
        </Button>
      </section>
    );
  }

  const isReady = isRemovalCompilationReady(compilation);
  const blockers =
    compilation.blockers.length > 0
      ? compilation.blockers
      : isReady
        ? []
        : [INCOMPLETE_ARTIFACT_BLOCKER];

  return (
    <section
      className="flex flex-col gap-12 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-16 py-12"
      aria-labelledby={headingId}
    >
      <div className="flex flex-wrap items-start justify-between gap-12">
        <div className="flex items-start gap-12">
          {isReady ? (
            <CheckCircleIcon
              size={20}
              weight="fill"
              aria-hidden
              className="mt-2 shrink-0 text-[var(--st-ok)]"
            />
          ) : (
            <WarningIcon
              size={20}
              weight="fill"
              aria-hidden
              className="mt-2 shrink-0 text-[var(--st-bad)]"
            />
          )}
          <div className="flex flex-col gap-2">
            <h4
              id={headingId}
              className="body-small font-medium text-[var(--color-text-primary)]"
            >
              {isReady ? "Compilation ready" : "Compilation blocked"}
            </h4>
            <p className="body-caption text-[var(--color-text-secondary)]">
              {isReady
                ? "The registry submission compiled successfully."
                : "Resolve every compiler blocker before submitting."}
            </p>
          </div>
        </div>
        {!isReady && (
          <Button variant="weak" size="small" onClick={onOpenTechnicalDetails}>
            Open technical details
          </Button>
        )}
      </div>

      <CompilationBlockers blockers={blockers} showHeading={false} />

      {compilation.warnings.length > 0 && (
        <div className="flex flex-col gap-4 border-l-2 border-[var(--st-wait)] pl-12">
          <p className="body-small font-medium text-[var(--color-text-primary)]">
            Captured but not represented
          </p>
          <CompilationWarnings warnings={compilation.warnings} />
        </div>
      )}
    </section>
  );
}

export function SubmissionReviewTabs({
  memberBatches,
  facilityId,
  compilation,
  isCompilationLoading,
  compilationError,
  onRetryCompilation,
  checks,
  isProduction,
}: SubmissionReviewTabsProps) {
  const [activeTab, setActiveTab] = useState<ReviewTab>(REVIEW_TAB);
  const tabsId = useId();
  const reviewTabId = `${tabsId}-review-tab`;
  const reviewPanelId = `${tabsId}-review-panel`;
  const technicalTabId = `${tabsId}-technical-tab`;
  const technicalPanelId = `${tabsId}-technical-panel`;

  const selectTab = (value: Tabs.Tab.Value) => {
    if (value === REVIEW_TAB || value === TECHNICAL_TAB) {
      setActiveTab(value);
    }
  };

  return (
    <Tabs.Root value={activeTab} onValueChange={selectTab}>
      <Tabs.List
        aria-label="Submission review"
        className="flex border-b border-[var(--color-border-secondary)]"
      >
        <Tabs.Tab
          id={reviewTabId}
          aria-controls={reviewPanelId}
          value={REVIEW_TAB}
          className="h-40 border-b-2 border-transparent px-12 label-button text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-light)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] data-[active]:border-[var(--color-interaction)] data-[active]:text-[var(--color-text-primary)]"
        >
          Review
        </Tabs.Tab>
        <Tabs.Tab
          id={technicalTabId}
          aria-controls={technicalPanelId}
          value={TECHNICAL_TAB}
          className="h-40 border-b-2 border-transparent px-12 label-button text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-light)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)] data-[active]:border-[var(--color-interaction)] data-[active]:text-[var(--color-text-primary)]"
        >
          Technical details
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel
        id={reviewPanelId}
        aria-labelledby={reviewTabId}
        value={REVIEW_TAB}
        className="flex flex-col gap-12 pt-12"
      >
        <SubmissionOverview
          memberBatches={memberBatches}
          facilityId={facilityId}
        />
        <CompilationStatus
          compilation={compilation}
          isLoading={isCompilationLoading}
          error={compilationError}
          onOpenTechnicalDetails={() => setActiveTab(TECHNICAL_TAB)}
        />
        <SubmissionChecks checks={checks} facilityId={facilityId} />
        <EnvBanner isProduction={isProduction} variant="inline" />
      </Tabs.Panel>

      <Tabs.Panel
        id={technicalPanelId}
        aria-labelledby={technicalTabId}
        value={TECHNICAL_TAB}
        keepMounted
        className="pt-12"
      >
        <CompiledSubmissionReview
          compilation={compilation}
          isLoading={isCompilationLoading}
          error={compilationError}
          onRetry={onRetryCompilation}
        />
      </Tabs.Panel>
    </Tabs.Root>
  );
}
