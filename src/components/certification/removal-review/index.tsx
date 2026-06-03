/**
 * RemovalReview — the guided, full-width Review & submit flow for one Removal
 * (route: /certification/removals/[removalId]/review). The "complex" path of
 * ADR 0003 decision 6: where multi-batch, blocked, or evidence-bearing removals
 * are assembled, reviewed, evidenced, pre-flighted, and submitted. The simple
 * 1:1 ready case one-click-submits from the table's side-sheet instead.
 *
 * The five steps share one source of truth — the removal Certify context
 * (`useRemovalCertifyContext`) folded through the shared
 * `deriveRemovalReadiness` classifier — so the Pre-flight verdict matches the
 * Overview queue and the table hint exactly. Steps are deep-linkable via
 * `?step=`; the superseded Sources detail page redirects to `?step=evidence`.
 */
"use client";

import Link from "next/link";
import { parseAsStringEnum, useQueryState } from "nuqs";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useRemovalCertifyContext } from "@/hooks/use-certification";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import {
  buildRemovalPreflightChecklist,
  canRegroupRemoval,
  deriveRemovalReadiness,
  type RemovalReadinessFacts,
} from "@/lib/certification/readiness";
import type { LocalSubmissionStatus } from "@/lib/certification/status";
import { isLockedInFlight } from "@/lib/isometric/utils/lock";
import { Button } from "@/components/ui";
import { AssembleStep } from "./assemble-step";
import { ReviewStep } from "./review-step";
import { EvidenceStep } from "./evidence-step";
import { PreflightStep } from "./preflight-step";
import { SubmitStep } from "./submit-step";

const STEPS: StepFlowStep[] = [
  { key: "assemble", label: "Assemble" },
  { key: "review", label: "Review" },
  { key: "evidence", label: "Evidence" },
  { key: "preflight", label: "Pre-flight" },
  { key: "submit", label: "Submit" },
];
const STEP_KEYS = [
  "assemble",
  "review",
  "evidence",
  "preflight",
  "submit",
] as const;
type StepKey = (typeof STEP_KEYS)[number];

// Maps the UI context's facts onto the shared readiness classifier — the same
// projection the server-owned Overview loader builds, so a removal's verdict is
// identical whether it's read here or in the queue.
function buildFacts(ctx: RemovalCertifyContext): RemovalReadinessFacts {
  const lockInFlight = ctx.latestSubmission
    ? isLockedInFlight(ctx.latestSubmission)
    : false;
  return {
    local: (ctx.latestSubmission?.status ?? null) as LocalSubmissionStatus | null,
    lockInFlight,
    hasMapping: !!ctx.mapping,
    hasDefaultTemplate: !!ctx.defaultTemplate,
    missingDefaultTemplateId: ctx.missingDefaultTemplateId,
    unresolvedBlueprintKeys: ctx.unresolvedBlueprintKeys,
    hasSubmittableRuns: ctx.hasSubmittableRuns,
    requiredTransport: ctx.requiredTransportCategories.map((category) => {
      const bucket = ctx.transportCoverage[category];
      return {
        category,
        count: bucket.count,
        hasAggregationWarning: bucket.aggregationWarning !== null,
      };
    }),
  };
}

export function RemovalReview({ removalId }: { removalId: string }) {
  const ctxQuery = useRemovalCertifyContext(removalId);
  const [step, setStep] = useQueryState(
    "step",
    parseAsStringEnum<StepKey>([...STEP_KEYS])
      .withDefault("assemble")
      .withOptions({ shallow: true, history: "replace" }),
  );

  return (
    <div className="container-max flex flex-col gap-32 py-32">
      <Header
        removalId={removalId}
        facilityId={ctxQuery.data?.facilityId ?? null}
      />
      {ctxQuery.isLoading ? (
        <p className="body-medium text-[var(--color-text-tertiary)]">
          Loading removal…
        </p>
      ) : ctxQuery.error || !ctxQuery.data ? (
        <div className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-20">
          <p className="body-medium text-[var(--clr-red)]" role="alert">
            Unable to load this removal. Try refreshing the page.
          </p>
        </div>
      ) : (
        <Flow
          removalId={removalId}
          ctx={ctxQuery.data}
          step={step}
          onStep={setStep}
        />
      )}
    </div>
  );
}

function Header({
  removalId,
  facilityId,
}: {
  removalId: string;
  facilityId: string | null;
}) {
  const backHref = facilityId
    ? `/certification/removals?facility=${facilityId}`
    : "/certification/removals";
  return (
    <header className="flex flex-col gap-8">
      <Link
        href={backHref}
        className="body-caption text-[var(--color-text-tertiary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)]"
      >
        ← Removals
      </Link>
      <span className="title-chapter-title text-[var(--color-text-tertiary)]">
        Certification
      </span>
      <h1 className="title-heading-2">Review &amp; submit</h1>
      <span className="body-caption font-mono text-[var(--color-text-tertiary)]">
        {removalId}
      </span>
    </header>
  );
}

function Flow({
  removalId,
  ctx,
  step,
  onStep,
}: {
  removalId: string;
  ctx: RemovalCertifyContext;
  step: StepKey;
  onStep: (key: StepKey) => void;
}) {
  const facts = buildFacts(ctx);
  const readiness = deriveRemovalReadiness(facts);
  const checklist = buildRemovalPreflightChecklist(facts);
  const regroupable = canRegroupRemoval({
    local: facts.local,
    lockInFlight: facts.lockInFlight,
  });

  const currentIndex = STEP_KEYS.indexOf(step);
  const goTo = (index: number) => {
    if (index >= 0 && index < STEP_KEYS.length) onStep(STEP_KEYS[index]);
  };

  // The only forward gate: a removal with no member batches has nothing to
  // review. Everything downstream is informational until the Submit step,
  // which gates the actual submit on the readiness verdict.
  const canProceed = step === "assemble" ? ctx.memberBatches.length > 0 : true;
  const isLastStep = currentIndex === STEP_KEYS.length - 1;

  const footer = (
    <div className="flex items-center justify-between gap-12">
      <Button
        variant="default"
        onClick={() => goTo(currentIndex - 1)}
        disabled={currentIndex === 0}
      >
        Back
      </Button>
      {!isLastStep && (
        <Button
          variant="primary"
          onClick={() => goTo(currentIndex + 1)}
          disabled={!canProceed}
        >
          Next
        </Button>
      )}
    </div>
  );

  return (
    <StepFlow
      steps={STEPS}
      current={currentIndex}
      furthest={STEPS.length - 1}
      onNavigate={goTo}
      footer={footer}
    >
      {step === "assemble" && (
        <AssembleStep ctx={ctx} removalId={removalId} canRegroup={regroupable} />
      )}
      {step === "review" && <ReviewStep ctx={ctx} />}
      {step === "evidence" && <EvidenceStep removalId={removalId} />}
      {step === "preflight" && (
        <PreflightStep checklist={checklist} readiness={readiness} />
      )}
      {step === "submit" && (
        <SubmitStep
          removalId={removalId}
          readiness={readiness}
          isProduction={ctx.isProduction}
          externalId={ctx.latestSubmission?.externalId ?? null}
          facilityId={ctx.facilityId}
          onGoToPreflight={() => onStep("preflight")}
        />
      )}
    </StepFlow>
  );
}
