/**
 * SubmissionSummary: the read surface of Review & submit, D1a (#1554). It is
 * only the check before sending: what to fix, or what gets sent. Figures as a
 * record belong to the Removal sheet.
 *
 *   Blocked: "Fix these to submit" with one row per fix. Nothing else to read.
 *   Ready:   one bordered block led by the CO₂e estimate; its last row opens
 *            the details. Non-blocking notes sit under it as one group.
 *
 * It gates nothing. `submit-step.tsx` owns the submit gate via
 * `deriveRemovalReadiness` + `isRemovalCompilationReady`.
 */
"use client";

import { CaretRightIcon, SpinnerGapIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Notice } from "@/components/ui/notice";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { MISSING_VALUE, TRY_AGAIN_LABEL } from "@/lib/copy-utils";
import { formatTonnes } from "@/lib/format-utils";
import type { SharedSourceFile } from "@/lib/certification/shared-source-files";
import { cn } from "@/lib/utils";
import { RemovalAdvisoryList, CompilationWarnings } from "./compilation-notices";
import { ChangedGroup, FixedAck, FixList, type ChangedFigure } from "./review-parts";
import { SharedSourceFileNotes } from "./shared-source-file-notices";
import {
  buildSubmissionFacts,
  countLabel,
  type SubmissionFactsInput,
} from "./submission-facts";
import type { FixEntry } from "./use-fix-progress";

const ESTIMATE_NOTE =
  "Estimated before project emissions and registry verification. Isometric calculates the final net value.";
const FILES_NOTE = "noma uploads these files to Isometric when you submit.";
const TOTAL_UNIT = "t CO₂e";
const SPINNER_SIZE = 20;
/** Two codes read better than a count; more than two become a count. */
const MAX_LISTED_BATCH_CODES = 2;
const BLOCK_BORDER = "border border-[var(--color-border-secondary)] bg-[var(--paper)]";
const ROW_RULE = "border-t border-[var(--color-border-secondary)]";

type SubmissionSummaryProps = SubmissionFactsInput & {
  facilityId: string;
  /** Fixes in the order first seen, with the ones done since the step opened. */
  entries: readonly FixEntry[];
  /** Figures changed since the last submit; empty unless the Removal came back. */
  changes: readonly ChangedFigure[];
  /** Files that back evidence of different kinds (#1531); advisory. */
  sharedFiles?: readonly SharedSourceFile[];
  onFix: () => void;
  onOpenDetails: () => void;
  onRetryCompilation: () => void;
};

function BlockRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-16 gap-y-2 py-8", "[border-top:var(--row-divider)] first:[border-top:none]")}>
      <dt className="body-small text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="grow text-right body-small tabular-nums">{children}</dd>
    </div>
  );
}

/**
 * The block's last row: the whole row opens the details. A raw button on
 * purpose: `Button` is a centred, bordered action, and this is a full-width
 * disclosure row inside the block.
 */
function DetailsRow({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-h-44 w-full items-center justify-between gap-12 px-16 text-left body-small",
        ROW_RULE,
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]",
      )}
    >
      <span className="underline underline-offset-4">See what this Removal sends</span>
      <CaretRightIcon size={14} aria-hidden />
    </button>
  );
}

function batchesValue(codes: readonly string[]): string {
  if (codes.length === 0) return MISSING_VALUE.none;
  return codes.length <= MAX_LISTED_BATCH_CODES ? codes.join(", ") : countLabel(codes.length, "credit batch", "credit batches");
}

export function SubmissionSummary({
  facilityId,
  entries,
  changes,
  sharedFiles = [],
  onFix,
  onOpenDetails,
  onRetryCompilation,
  ...factsInput
}: SubmissionSummaryProps) {
  const facts = buildSubmissionFacts(factsInput);
  const memberBatchIds = facts.batches.map((batch) => batch.id);
  const estimate = factsInput.compilation?.estimatedStoredCo2eTonnes ?? null;
  const compileFailed = !factsInput.isCompilationLoading && (Boolean(factsInput.compilationError) || !factsInput.compilation);
  const openFixes = entries.filter((entry) => !entry.fixed);
  const refusal = Boolean(factsInput.rejectionMessage) || factsInput.readiness.state === "inProgress";

  if (facts.state === "loading") {
    return (
      <div role="status" className="flex items-center gap-12 body-small text-[var(--color-text-secondary)]">
        <SpinnerGapIcon size={SPINNER_SIZE} weight="bold" aria-hidden className="animate-spin text-[var(--st-run)]" />
        <span>{facts.headline}. {facts.detail}</span>
      </div>
    );
  }

  if (facts.state === "blocked") {
    return (
      <div className="flex flex-col gap-16">
        {compileFailed && (
          <Notice
            tone="error"
            action={
              <Button variant="weak" className={PHONE_TOUCH_TARGET} onClick={onRetryCompilation}>
                {TRY_AGAIN_LABEL}
              </Button>
            }
          >
            The submission details could not be prepared.
          </Notice>
        )}
        {/* A refusal that no fix row carries (rejected in Isometric, a submission running) says so itself,
            whatever is still open. Only the generic checks/blockers verdict is left to the fix list. */}
        {(refusal || (!compileFailed && openFixes.length === 0)) && (
          <Notice tone="error" title={facts.headline}>
            {facts.detail}
          </Notice>
        )}
        {entries.length > 0 && <FixList entries={entries} onFix={onFix} />}
        <div className={BLOCK_BORDER}>
          <DetailsRow onOpen={onOpenDetails} />
        </div>
      </div>
    );
  }

  const hasNotes =
    factsInput.readiness.transportVehicleAdvisories.length > 0 ||
    facts.advisories.length > 0 ||
    facts.warnings.length > 0 ||
    sharedFiles.length > 0;

  return (
    <div className="flex flex-col gap-16">
      <FixedAck entries={entries} />
      <ChangedGroup changes={changes} />
      <section aria-label="What this Removal sends" className={cn(BLOCK_BORDER, "flex flex-col")}>
        <div className="flex flex-col gap-2 px-16 pt-16 pb-12">
          <span className="inline-flex items-center gap-4 body-small text-[var(--color-text-secondary)]">
            Estimated CO₂e stored
            <ExplanationInfo title="Estimated CO₂e stored" hint={ESTIMATE_NOTE} />
          </span>
          {estimate == null ? (
            <span className="body-large text-[var(--color-text-tertiary)]">{MISSING_VALUE.notYetComputed}</span>
          ) : (
            <span className="whitespace-nowrap title-heading-2 tabular-nums">
              {formatTonnes(estimate, { digits: 1, unit: TOTAL_UNIT })}
            </span>
          )}
        </div>
        <dl className={cn("flex flex-col px-16 py-4", ROW_RULE)}>
          <BlockRow label={facts.batchCount === 1 ? "Credit batch" : "Credit batches"}>
            {batchesValue(facts.batches.map((batch) => batch.code))}
          </BlockRow>
          <BlockRow label="Biochar dry mass">{facts.dryTons}</BlockRow>
          {facts.reportingWindowLabel && <BlockRow label="Reporting window">{facts.reportingWindowLabel}</BlockRow>}
          {facts.pendingDocuments > 0 && (
            <BlockRow label="Files to upload">
              {countLabel(facts.pendingDocuments, "file")}
              <ExplanationInfo title="Files to upload" hint={FILES_NOTE} />
            </BlockRow>
          )}
        </dl>
        <DetailsRow onOpen={onOpenDetails} />
      </section>

      {hasNotes && (
        <section aria-labelledby="review-notes" className="flex flex-col gap-8">
          <h3 id="review-notes" className="body-lead font-medium">
            Check before submitting
          </h3>
          <div className="flex flex-col gap-8 body-small text-[var(--color-text-secondary)]">
            {factsInput.readiness.transportVehicleAdvisories.map((advisory) => (
              <p key={advisory}>{advisory}</p>
            ))}
            <RemovalAdvisoryList advisories={facts.advisories} facilityId={facilityId} memberBatchIds={memberBatchIds} />
            <CompilationWarnings warnings={facts.warnings} />
            <SharedSourceFileNotes files={sharedFiles} />
          </div>
        </section>
      )}
    </div>
  );
}
