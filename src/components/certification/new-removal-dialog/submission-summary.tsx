/**
 * SubmissionSummary — the read surface of the confirm-&-submit step. One
 * vertical read that answers three questions in order: can I send this, what am
 * I sending, where does it go. Every fact appears exactly once, and the checks
 * list only renders when one of them needs attention — when they all pass the
 * verdict line carries the count.
 *
 * This is a read surface: it gates nothing. `submit-step.tsx` still owns the
 * submit gate via `deriveRemovalReadiness` + `isRemovalCompilationReady`.
 */
"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  SpinnerGapIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { MemberCreditBatch } from "@/fn/certification/certify-context";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { EnvBanner } from "../env-banner";
import { CompilationWarnings } from "./compilation-notices";
import {
  batchDryTons,
  buildSubmissionFacts,
  countLabel,
  type SubmissionFactsInput,
  type SubmitState,
} from "./submission-facts";
import { SubmissionChecks } from "./submission-checks";

const STATE_ICON_SIZE = 20;
const BATCH_LINK_ICON_SIZE = 12;

const VERDICT_RULE: Record<SubmitState, string> = {
  ready: "border-[var(--st-ok)]",
  loading: "border-[var(--st-run)]",
  blocked: "border-[var(--st-bad)]",
};

type SubmissionSummaryProps = SubmissionFactsInput & { facilityId: string };

function StateIcon({ state }: { state: SubmitState }) {
  if (state === "loading") {
    return (
      <SpinnerGapIcon
        size={STATE_ICON_SIZE}
        weight="bold"
        aria-hidden
        className="shrink-0 animate-spin text-[var(--st-run)]"
      />
    );
  }
  if (state === "blocked") {
    return (
      <WarningIcon
        size={STATE_ICON_SIZE}
        weight="fill"
        aria-hidden
        className="shrink-0 text-[var(--st-bad)]"
      />
    );
  }
  return (
    <CheckCircleIcon
      size={STATE_ICON_SIZE}
      weight="fill"
      aria-hidden
      className="shrink-0 text-[var(--st-ok)]"
    />
  );
}

function BatchLink({
  batch,
  facilityId,
}: {
  batch: MemberCreditBatch;
  facilityId: string;
}) {
  return (
    <Link
      href={creditBatchDeepLinkHref(batch.id, facilityId)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open credit batch ${batch.code} in a new tab`}
      className="inline-flex items-center gap-4 font-mono text-[var(--color-text-primary)] underline-offset-4 hover:text-[var(--color-interaction)] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-interaction)]"
    >
      {batch.code}
      <ArrowSquareOutIcon size={BATCH_LINK_ICON_SIZE} aria-hidden />
    </Link>
  );
}

/**
 * Label/value ledger row — the same idiom as `carbon-breakdown.tsx`, with the
 * hairline and padding these rows need inside a bordered panel.
 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-16 gap-y-2 border-t border-[var(--color-border-tertiary)] px-20 py-8">
      <dt className="body-small text-[var(--color-text-secondary)]">{label}</dt>
      <dd className="body-small text-right text-[var(--color-text-primary)]">
        {children}
      </dd>
    </div>
  );
}

export function SubmissionSummary({
  facilityId,
  ...factsInput
}: SubmissionSummaryProps) {
  const facts = buildSubmissionFacts(factsInput);
  const { checks } = factsInput;

  return (
    <div className="flex flex-col gap-16">
      <div
        className={`flex items-start gap-12 border-l-2 py-4 pl-12 ${VERDICT_RULE[facts.state]}`}
        role={facts.state === "blocked" ? "alert" : "status"}
      >
        <span className="mt-2">
          <StateIcon state={facts.state} />
        </span>
        <div className="flex flex-col gap-2">
          <span className="body-medium font-medium text-[var(--color-text-primary)]">
            {facts.headline}
          </span>
          <span className="body-small text-[var(--color-text-secondary)]">
            {facts.detail}
          </span>
        </div>
      </div>

      {facts.blockers.length > 0 && (
        <ul className="list-disc border border-[var(--st-bad-border)] bg-[var(--st-bad-bg)] py-8 pr-16 pl-32 body-small text-[var(--color-text-primary)]">
          {facts.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}

      <section className="border border-[var(--color-border-primary)] bg-[var(--color-background-white)]">
        <div className="flex flex-col gap-4 px-20 py-16">
          <span className="body-small text-[var(--color-text-secondary)]">
            You are sending
          </span>
          <span className="title-heading-2 font-mono text-[var(--color-text-primary)]">
            {facts.dryTons}
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Biochar, dry mass. Isometric calculates stored and net CO₂e after
            submission.
          </span>
        </div>

        <dl className="flex flex-col">
          <Fact label="Destination">
            {facts.projectLabel} ({facts.environmentLabel})
          </Fact>
          <Fact label="Crediting window">{facts.windowLabel ?? "Not set"}</Fact>
          <Fact
            label={facts.batchCount === 1 ? "Credit batch" : "Credit batches"}
          >
            <span className="flex flex-col items-end gap-2">
              {facts.batches.map((batch) => (
                <span key={batch.id} className="inline-flex items-center gap-8">
                  {facts.batchCount > 1 && (
                    <span className="font-mono text-[var(--color-text-tertiary)]">
                      {batchDryTons(batch)}
                    </span>
                  )}
                  <BatchLink batch={batch} facilityId={facilityId} />
                </span>
              ))}
            </span>
          </Fact>
          <Fact label="Traced back to">
            {countLabel(facts.runCount, "production run")},{" "}
            {countLabel(facts.applicationCount, "application")}
          </Fact>
          <Fact label="Durability">{facts.durabilityLabel}</Fact>
          <Fact label="Sampling">{facts.samplingLabel}</Fact>
          {facts.pendingDocuments > 0 && (
            <Fact label="Supporting files">
              {countLabel(facts.pendingDocuments, "file")} upload on submit
            </Fact>
          )}
        </dl>
      </section>

      {facts.checksAttention > 0 && (
        <SubmissionChecks checks={checks} facilityId={facilityId} />
      )}

      {facts.warnings.length > 0 && (
        <div className="flex flex-col gap-4 border-l-2 border-[var(--st-wait)] pl-12">
          <span className="body-small font-medium text-[var(--color-text-primary)]">
            Recorded but not submitted
          </span>
          <CompilationWarnings warnings={facts.warnings} />
        </div>
      )}

      {facts.isProduction && <EnvBanner isProduction variant="inline" />}
    </div>
  );
}
