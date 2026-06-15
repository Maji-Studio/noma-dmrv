/**
 * GhgStatementCreateDrawer — period-first GHG Statement creation, in a
 * SlideOverPanel (it's a multi-step form, so a side-sheet is the right chrome).
 * Three steps:
 *   1. Period   — pick the reporting-period end (`end_on`, the only date the
 *                 Isometric create API accepts). We display the *derived* start
 *                 (day after the prior statement's period) so the operator sees
 *                 a full [start → end] window even though only the end is sent.
 *   2. Preview  — the removals *predicted* to be linked by completion date, as
 *                 a cross-link accordion (each expands to its credit batches +
 *                 a link to the removal). Membership is decided server-side, so
 *                 this is a forecast.
 *   3. Confirm  — production-gated create; the result panel shows what Isometric
 *                 actually reconciled (+ any drift warnings).
 *
 * Reporting periods are consecutive and non-overlapping: the operator can't pick
 * an end on or before an existing statement's end (mirrored server-side).
 *
 * The drawer mounts only while open (the list renders it conditionally), so the
 * RHF form and mutation start fresh each time — no Modal-style onOpen reset.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { InfoHint } from "@/components/ui/tooltip";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import {
  useCreateGhgStatement,
  useGhgStatementsForFacility,
  useOpenRemovalsForFacility,
} from "@/hooks/use-certification";
import { addDaysIso } from "@/lib/date-utils";
import {
  createGhgStatementSchema,
  type CreateGhgStatementInput,
} from "@/schemas/certification";
import type { OpenRemovalView } from "@/fn/certification/ghg-statements";
import { EnvBanner } from "./env-banner";
import { ProductionConfirmation } from "./production-confirmation";
import { RemovalBatchesAccordion } from "./removal-batches-accordion";

interface GhgStatementCreateDrawerProps {
  facilityId: string;
  isProduction: boolean;
  open: boolean;
  onClose: () => void;
}

const STEPS: StepFlowStep[] = [
  { key: "period", label: "Period", description: "Pick the end date" },
  { key: "preview", label: "Preview", description: "Predicted removals" },
  { key: "confirm", label: "Confirm", description: "Create the statement" },
];

// The latest existing period end strictly before `endOn` defines the new
// period's start (day after) — Isometric derives the same. Null for the first
// statement, where Isometric anchors the start to the project start.
function derivePeriodStart(
  endOn: string,
  existingEnds: string[],
): string | null {
  const priorEnd = existingEnds
    .filter((end) => end < endOn)
    .reduce<string | null>((max, end) => (!max || end > max ? end : max), null);
  return priorEnd ? addDaysIso(priorEnd, 1) : null;
}

// The latest existing end that the chosen `endOn` would overlap — periods are
// consecutive, so a new end on or before another statement's end carves a
// period inside it. The own-end is excluded so re-picking an existing period
// resolves to that statement instead of erroring.
function overlappingEnd(endOn: string, existingEnds: string[]): string | null {
  const latestOther = existingEnds
    .filter((end) => end !== endOn)
    .reduce<string | null>((max, end) => (!max || end > max ? end : max), null);
  return latestOther && endOn <= latestOther ? latestOther : null;
}

export function GhgStatementCreateDrawer({
  facilityId,
  isProduction,
  open,
  onClose,
}: GhgStatementCreateDrawerProps) {
  return (
    <SlideOverPanel.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      // Multi-step wizard: a stray backdrop click must not discard a
      // half-built statement. Close button + ESC still dismiss.
      dismissOnClickOutside={false}
    >
      <SlideOverPanel.Content size="wide">
        {open && (
          <DrawerBody
            key={facilityId}
            facilityId={facilityId}
            isProduction={isProduction}
            onClose={onClose}
          />
        )}
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}

function DrawerBody({
  facilityId,
  isProduction,
  onClose,
}: {
  facilityId: string;
  isProduction: boolean;
  onClose: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [furthest, setFurthest] = useState(0);
  const toast = useToast();
  const mutation = useCreateGhgStatement();
  const statementsQuery = useGhgStatementsForFacility(facilityId);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setError,
    formState: { errors },
  } = useForm<CreateGhgStatementInput>({
    resolver: zodResolver(createGhgStatementSchema),
    defaultValues: {
      facilityId,
      reportingPeriodEndOn: "",
      confirmProduction: false,
    },
  });

  const endOn = watch("reportingPeriodEndOn");
  const existingEnds = (statementsQuery.data ?? []).map(
    (item) => item.statement.reportingPeriodEndOn,
  );
  const derivedStart = endOn ? derivePeriodStart(endOn, existingEnds) : null;
  // The preview query only runs once the operator reaches the Preview step.
  const openQuery = useOpenRemovalsForFacility(facilityId, stepIndex >= 1);

  const goTo = async (index: number) => {
    if (index > stepIndex && stepIndex === 0) {
      if (!(await trigger("reportingPeriodEndOn"))) return;
      const overlap = overlappingEnd(endOn, existingEnds);
      if (overlap) {
        setError("reportingPeriodEndOn", {
          message: `This facility already has a statement ending ${overlap}. Reporting periods can't overlap — pick an end date after ${overlap}.`,
        });
        return;
      }
    }
    setStepIndex(index);
    setFurthest((f) => Math.max(f, index));
  };

  const advance = async () => {
    await goTo(stepIndex + 1);
  };

  const onCreate = handleSubmit(async (data) => {
    if (isProduction && !data.confirmProduction) {
      setError("confirmProduction", {
        message: "Tick the box to confirm this submits to the live production registry.",
      });
      return;
    }
    try {
      const result = await mutation.mutateAsync(data);
      if (result.warnings.length > 0) {
        toast.warning(
          `GHG statement created with ${result.warnings.length} warning(s).`,
        );
      } else {
        toast.success(
          `GHG statement created — ${result.linkedRemovalIds.length} removal(s) linked.`,
        );
      }
    } catch (err) {
      setError("root.serverError", {
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  });

  const result = mutation.data;
  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <>
      <SlideOverPanel.Header showClose>
        <SlideOverPanel.Title>New GHG Statement</SlideOverPanel.Title>
        <SlideOverPanel.Description>
          {result
            ? "Created — review what Isometric linked"
            : "Pick a reporting period — Isometric links the removals completed inside it"}
        </SlideOverPanel.Description>
      </SlideOverPanel.Header>

      <SlideOverPanel.Body className="flex flex-col gap-24">
        {result ? (
          <ResultPanel
            externalId={result.externalId}
            linkedCount={result.linkedRemovalIds.length}
            warnings={result.warnings}
          />
        ) : (
          <StepFlow
            orientation="vertical"
            steps={STEPS}
            current={stepIndex}
            furthest={furthest}
            onNavigate={goTo}
          >
            {stepIndex === 0 && (
              <StepPeriod
                register={register}
                error={errors.reportingPeriodEndOn?.message}
                endOn={endOn}
                derivedStart={derivedStart}
              />
            )}
            {stepIndex === 1 && (
              <StepPreview
                query={openQuery}
                endOn={endOn}
                derivedStart={derivedStart}
                facilityId={facilityId}
              />
            )}
            {stepIndex === 2 && (
              <StepConfirm
                endOn={endOn}
                derivedStart={derivedStart}
                isProduction={isProduction}
                registerProps={register("confirmProduction")}
                confirmError={errors.confirmProduction?.message}
              />
            )}
            {errors.root?.serverError?.message && (
              <div className="mt-16">
                <ServerError message={errors.root.serverError.message} />
              </div>
            )}
          </StepFlow>
        )}
      </SlideOverPanel.Body>

      <SlideOverPanel.Footer>
        {result ? (
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        ) : (
          <>
            <Button
              variant="default"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            {stepIndex > 0 && (
              <Button
                variant="default"
                onClick={() => setStepIndex((s) => s - 1)}
                disabled={mutation.isPending}
              >
                Back
              </Button>
            )}
            {isLastStep ? (
              <Button
                variant="primary"
                onClick={onCreate}
                busy={mutation.isPending}
              >
                Create GHG Statement
              </Button>
            ) : (
              <Button variant="primary" onClick={advance}>
                Next
              </Button>
            )}
          </>
        )}
      </SlideOverPanel.Footer>
    </>
  );
}

// Renders the resolved [start → end] reporting window. The start is derived
// (or set by Isometric for the first statement), never operator-entered.
function PeriodWindow({
  derivedStart,
  endOn,
}: {
  derivedStart: string | null;
  endOn: string;
}) {
  return (
    <span className="font-mono text-[var(--color-text-primary)]">
      {derivedStart ?? "Set by Isometric"} → {endOn}
    </span>
  );
}

function StepPeriod({
  register,
  error,
  endOn,
  derivedStart,
}: {
  register: UseFormRegister<CreateGhgStatementInput>;
  error?: string;
  endOn: string;
  derivedStart: string | null;
}) {
  return (
    <div className="flex flex-col gap-12">
      <h3 className="title-heading-4 flex items-center gap-6">
        Reporting period
        <InfoHint>
          Pick the reporting-period end date. Isometric links every Removal
          whose completion date falls in the period to this statement, and
          derives the period start from the previous statement.
        </InfoHint>
      </h3>
      <FormField
        id="reportingPeriodEndOn"
        label="Reporting period end"
        required
        error={error}
      >
        <FormInput
          id="reportingPeriodEndOn"
          type="date"
          error={!!error}
          {...register("reportingPeriodEndOn")}
        />
      </FormField>
      {endOn && !error && (
        <div className="flex flex-col gap-2 border-l-2 border-[var(--color-border-secondary)] pl-12">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Reporting period
          </span>
          <PeriodWindow derivedStart={derivedStart} endOn={endOn} />
        </div>
      )}
    </div>
  );
}

function StepPreview({
  query,
  endOn,
  derivedStart,
  facilityId,
}: {
  query: ReturnType<typeof useOpenRemovalsForFacility>;
  endOn: string;
  derivedStart: string | null;
  facilityId: string;
}) {
  if (query.isLoading) {
    return (
      <p
        aria-busy="true"
        className="body-small text-[var(--color-text-tertiary)]"
      >
        Loading open removals…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-small text-[var(--clr-red)]" role="alert">
        Unable to load removals. Go back and try again.
      </p>
    );
  }

  // Lexical comparison is correct for YYYY-MM-DD strings. A removal with no
  // completion date cannot be predicted in-period. Isometric links removals
  // whose completion falls within [derivedStart, endOn] — `derivedStart` is the
  // day after the previous statement (null for the first statement, where
  // Isometric anchors to the project start). Filtering only by `endOn` would
  // predict removals that Isometric then excludes, so apply the lower bound too.
  const inPeriod: OpenRemovalView[] = [];
  const outside: OpenRemovalView[] = [];
  for (const removal of query.data) {
    const completedOn = removal.completedOn;
    if (
      completedOn !== null &&
      completedOn <= endOn &&
      (derivedStart === null || completedOn >= derivedStart)
    ) {
      inPeriod.push(removal);
    } else {
      outside.push(removal);
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-4 flex items-center gap-6">
        Predicted removals
        <InfoHint>
          Membership is decided server-side by Isometric and confirmed after
          the statement is created — this predicts it by completion date within
          the reporting window{" "}
          {derivedStart ? `${derivedStart} → ${endOn}` : `up to ${endOn}`}.
          Removals before the window roll into the previous statement. Expand a
          removal to see its credit batches.
        </InfoHint>
      </h3>

      <div className="flex flex-col gap-8">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Predicted to be linked ({inPeriod.length})
        </span>
        {inPeriod.length === 0 ? (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            No open removals fall within this reporting window.
          </p>
        ) : (
          <RemovalBatchesAccordion
            facilityId={facilityId}
            entries={inPeriod.map((removal) => ({
              removalId: removal.removalId,
              label: removal.externalId,
              completedOn: removal.completedOn,
              creditBatches: removal.creditBatches,
            }))}
          />
        )}
      </div>

      <div className="flex flex-col gap-8 opacity-60">
        <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Open removals outside this period ({outside.length})
        </span>
        {outside.length === 0 ? (
          <p className="body-caption text-[var(--color-text-tertiary)]">
            No other open removals.
          </p>
        ) : (
          <RemovalBatchesAccordion
            facilityId={facilityId}
            entries={outside.map((removal) => ({
              removalId: removal.removalId,
              label: removal.externalId,
              completedOn: removal.completedOn,
              creditBatches: removal.creditBatches,
            }))}
          />
        )}
      </div>
    </div>
  );
}

function StepConfirm({
  endOn,
  derivedStart,
  isProduction,
  registerProps,
  confirmError,
}: {
  endOn: string;
  derivedStart: string | null;
  isProduction: boolean;
  registerProps: UseFormRegisterReturn;
  confirmError?: string;
}) {
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-4">Confirm &amp; create</h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        Create a GHG Statement for the reporting period{" "}
        <PeriodWindow derivedStart={derivedStart} endOn={endOn} />. Isometric
        derives the period start and links the matching Removals.
      </p>
      {isProduction ? (
        <ProductionConfirmation
          actionLabel="create a GHG statement on the production Isometric registry"
          registerProps={registerProps}
          errorMessage={confirmError}
        />
      ) : (
        <EnvBanner isProduction={false} variant="inline" />
      )}
    </div>
  );
}

function ResultPanel({
  externalId,
  linkedCount,
  warnings,
}: {
  externalId: string;
  linkedCount: number;
  warnings: string[];
}) {
  return (
    <div className="flex flex-col gap-16">
      <div className="flex items-start gap-8 border-l-2 border-[var(--color-signal-green)] pl-12 py-4">
        <CheckCircle
          size={18}
          weight="fill"
          aria-hidden
          className="mt-px shrink-0 text-[var(--color-signal-green)]"
        />
        <p className="body-small text-[var(--color-text-primary)]">
          GHG statement <span className="font-mono">{externalId}</span> created.
          Isometric linked{" "}
          <strong className="body-small-bold">{linkedCount}</strong> removal(s).
        </p>
      </div>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-8 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
          <span className="inline-flex items-center gap-6 title-chapter-title text-[var(--color-signal-orange)]">
            <Warning size={14} weight="fill" aria-hidden />
            {warnings.length} warning(s)
          </span>
          <ul className="flex flex-col gap-4">
            {warnings.map((w) => (
              <li
                key={w}
                className="body-caption text-[var(--color-text-secondary)]"
              >
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
