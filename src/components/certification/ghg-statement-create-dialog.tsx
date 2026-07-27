/**
 * GhgStatementCreateDialog — period-first GHG Statement creation in the shared
 * centered Modal.
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
 * an end on or before an existing statement's end (mirrored server-side). That
 * rule is *derived* from the watched date on every render, never pushed in with
 * `setError` — an imperative error outlived the edit that fixed it and only
 * cleared on the next Next click, which read as "first click says no, second
 * advances" (QA 2026-07-25).
 *
 * Modal unmounts its children while closed, so the RHF form and mutation start
 * fresh each time.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import {
  CheckCircleIcon,
  ClipboardTextIcon,
  InfoIcon,
  WarningIcon,
} from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { Button, EmptyState, Modal } from "@/components/ui";
import { StatusBadge } from "@/components/ui/status-badge";
import { InfoHint } from "@/components/ui/tooltip";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import {
  useCreateGhgStatement,
  useGhgStatementsForFacility,
  useOpenRemovalsForFacility,
  useRegistryGhgStatementsForFacility,
} from "@/hooks/use-certification";
import type { RegistryGhgStatementView } from "@/fn/certification";
import type { GhgStatementCreateOutcome } from "@/fn/certification/ghg-statements";
import {
  derivePeriodStart,
  liveOverlapEnd,
  partitionByWindow,
} from "@/lib/isometric/utils/ghg-reporting-window";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import {
  createGhgStatementSchema,
  type CreateGhgStatementInput,
} from "@/schemas/certification";
import { EnvBanner } from "./env-banner";
import { ProductionConfirmation } from "./production-confirmation";
import { RemovalBatchesAccordion } from "./removal-batches-accordion";

interface GhgStatementCreateDialogProps {
  facilityId: string;
  isProduction: boolean;
  open: boolean;
  onClose: () => void;
}

const STEPS: StepFlowStep[] = [
  { key: "period", label: "Period", description: "Choose the end" },
  { key: "preview", label: "Contents", description: "Preview removals" },
  { key: "confirm", label: "Confirm", description: "Review and create" },
];

const DIALOG_TITLE_ID = "ghg-statement-create-title";
const DIALOG_DESCRIPTION_ID = "ghg-statement-create-description";

// Period-derivation + window logic is shared with the server empty-statement
// guard (`ghg-reporting-window.ts`) so the operator's preview and the registry
// never disagree on what a period contains.

export function GhgStatementCreateDialog({
  facilityId,
  isProduction,
  open,
  onClose,
}: GhgStatementCreateDialogProps) {
  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      ariaLabelledBy={DIALOG_TITLE_ID}
      ariaDescribedBy={DIALOG_DESCRIPTION_ID}
      width="xl"
      dismissOnClickOutside={false}
    >
      <DialogBody
        key={facilityId}
        facilityId={facilityId}
        isProduction={isProduction}
        onClose={onClose}
      />
    </Modal>
  );
}

function DialogBody({
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
  const registryStatementsQuery =
    useRegistryGhgStatementsForFacility(facilityId);

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    setError,
    clearErrors,
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
  // The overlap rule is only as good as the list it is judged against, so step 0
  // holds until the local statements have actually loaded: a pending or failed
  // query would wave any period through against an empty list.
  const statementsLoaded = statementsQuery.isSuccess;
  const existingEnds = (statementsQuery.data ?? [])
    .filter((item) => !item.remotePeriodMissing)
    .map((item) => item.effectiveReportingPeriodEndOn);
  const derivedStart = endOn ? derivePeriodStart(endOn, existingEnds) : null;
  // Derived, so editing the date clears it; `liveOverlapEnd` also ignores the
  // half-typed years an `<input type="date">` emits mid-keystroke.
  const overlap = statementsLoaded ? liveOverlapEnd(endOn, existingEnds) : null;
  const periodError =
    errors.reportingPeriodEndOn?.message ??
    (overlap
      ? `A statement already ends ${overlap}. Choose a later date.`
      : undefined);
  // The preview query only runs once the operator reaches the Preview step.
  const openQuery = useOpenRemovalsForFacility(facilityId, stepIndex >= 1);

  // Predicted in-window membership drives both the #245 empty-statement gate
  // (can't advance/create an empty period) and the Contents step's framing.
  // Same window logic the server guard applies, so the two never disagree.
  const previewLoaded = openQuery.data !== undefined;
  const inPeriodCount = openQuery.data
    ? partitionByWindow(openQuery.data, derivedStart, endOn).inPeriod.length
    : 0;
  const isEmptyPeriod = previewLoaded && inPeriodCount === 0;

  const goTo = async (index: number) => {
    if (index > stepIndex && stepIndex === 0) {
      // Both guards are mirrored on the Next button's `disabled`, so neither
      // can present as a click that does nothing.
      if (!statementsLoaded) return;
      if (!(await trigger("reportingPeriodEndOn"))) return;
      if (overlap) return;
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
        message: "Confirm creation in the live Isometric registry.",
      });
      return;
    }
    try {
      const result = await mutation.mutateAsync(data);
      const linked = `${result.linkedRemovalIds.length} linked removal${result.linkedRemovalIds.length === 1 ? "" : "s"}`;
      if (result.outcome === "existing") {
        // ADR 0004: the create is idempotent per period, so this is a normal
        // success — but nothing was created and saying so would be a lie.
        toast.info(`Statement already existed for this period — ${linked}.`);
      } else if (result.warnings.length > 0) {
        toast.warning(
          `Created with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`,
        );
      } else {
        toast.success(`Created with ${linked}.`);
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
    <div className="flex flex-col gap-24">
      <header className="flex flex-col gap-4 pr-40">
        <h2 id={DIALOG_TITLE_ID} className="title-heading-3">
          New GHG Statement
        </h2>
        <p
          id={DIALOG_DESCRIPTION_ID}
          className="body-small text-[var(--color-text-secondary)]"
        >
          {result
            ? result.outcome === "existing"
              ? "Already in Isometric."
              : "Created in Isometric."
            : "Choose a period, preview removals, then create."}
        </p>
      </header>

      <div className="flex flex-col gap-24">
        {result ? (
          <ResultPanel
            outcome={result.outcome}
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
                // RHF only auto-revalidates a field after a *submit*, and this
                // wizard advances with `trigger()`. Without this the schema
                // error would also sit there until the next Next click, long
                // after the operator fixed the date.
                registerProps={register("reportingPeriodEndOn", {
                  onChange: () => clearErrors("reportingPeriodEndOn"),
                })}
                error={periodError}
                endOn={endOn}
                derivedStart={derivedStart}
                statementsQuery={statementsQuery}
                registryStatementsQuery={registryStatementsQuery}
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
      </div>

      <div className="sticky bottom-0 z-10 flex flex-wrap justify-end gap-12 border-t border-[var(--color-border-tertiary)] bg-[var(--color-background-white)] pt-16">
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
                disabled={isEmptyPeriod}
              >
                Create GHG Statement
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={advance}
                // On the Period step, wait for the existing statements the
                // overlap rule is judged against, and stay blocked while the
                // chosen end overlaps one. On the Contents step, block
                // advancing an empty period (#245): a statement with no
                // removals in-window would be a dead-end registry record. Also
                // wait for the preview to settle.
                disabled={
                  stepIndex === 0
                    ? !statementsLoaded || Boolean(overlap)
                    : stepIndex === 1 && (!previewLoaded || isEmptyPeriod)
                }
              >
                Next
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// The start is read-only: Isometric sets it for the first statement, then
// derives each later start from the previous statement's end.
export function PeriodWindow({
  derivedStart,
  endOn,
}: {
  derivedStart: string | null;
  endOn: string;
}) {
  return (
    <dl className="grid grid-cols-1 gap-12 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <dt className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          Start
        </dt>
        <dd className="body-small font-mono text-[var(--color-text-primary)]">
          {derivedStart ? formatDate(derivedStart) : "Set by Isometric"}
        </dd>
      </div>
      <div className="flex flex-col gap-2">
        <dt className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
          End
        </dt>
        <dd className="body-small font-mono text-[var(--color-text-primary)]">
          {formatDate(endOn)}
        </dd>
      </div>
    </dl>
  );
}

function StepPeriod({
  registerProps,
  error,
  endOn,
  derivedStart,
  statementsQuery,
  registryStatementsQuery,
}: {
  registerProps: UseFormRegisterReturn;
  error?: string;
  endOn: string;
  derivedStart: string | null;
  statementsQuery: ReturnType<typeof useGhgStatementsForFacility>;
  registryStatementsQuery: ReturnType<
    typeof useRegistryGhgStatementsForFacility
  >;
}) {
  return (
    <div className="flex flex-col gap-12">
      <h3 className="title-heading-4 flex items-center gap-6">
        Reporting period
        <InfoHint>
          Only the end date is sent. Isometric links submitted Removals
          completed within the period.
        </InfoHint>
      </h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        A GHG statement bundles the removals you&apos;ve already submitted this
        period so a verifier can review them. Pick the period end — we&apos;ll
        show you exactly which removals fall inside.
      </p>
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
          {...registerProps}
        />
      </FormField>
      <ExistingPeriodsStatus query={statementsQuery} />
      {endOn && !error && statementsQuery.isSuccess && (
        <div className="flex flex-col gap-8 border-l-2 border-[var(--color-border-secondary)] pl-12">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Reporting period
          </span>
          <PeriodWindow derivedStart={derivedStart} endOn={endOn} />
        </div>
      )}
      <RegistryStatementsPanel query={registryStatementsQuery} />
    </div>
  );
}

/**
 * Says out loud why Next can be unavailable on the Period step: the overlap
 * check and the derived start both need this facility's existing statements,
 * and neither a pending nor a failed load is an answer.
 */
function ExistingPeriodsStatus({
  query,
}: {
  query: ReturnType<typeof useGhgStatementsForFacility>;
}) {
  if (query.isSuccess) return null;
  if (query.isError) {
    return (
      <div className="flex flex-col items-start gap-8">
        <ServerError message="Couldn't load this facility's existing reporting periods, so this end date can't be checked for overlap yet." />
        <Button
          variant="default"
          size="small"
          onClick={() => void query.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  return (
    <p
      aria-busy="true"
      className="body-caption text-[var(--color-text-tertiary)]"
    >
      Checking existing reporting periods…
    </p>
  );
}

function RegistryStatementsPanel({
  query,
}: {
  query: ReturnType<typeof useRegistryGhgStatementsForFacility>;
}) {
  if (query.isLoading) {
    return (
      <div
        aria-busy="true"
        className="border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] p-16"
      >
        <p className="body-small text-[var(--color-text-tertiary)]">
          Loading registry statements…
        </p>
      </div>
    );
  }
  if (query.error || !query.data) {
    return <ServerError message="Unable to load registry statements." />;
  }
  if (query.data.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardTextIcon size={32} />}
        title="No registry statements"
        description="This project has no GHG statements in the registry."
        padding="sm"
      />
    );
  }
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h4 className="title-heading-4">Already in the registry</h4>
        <p className="body-caption text-[var(--color-text-tertiary)]">
          Review these before choosing a new reporting period.
        </p>
      </div>
      <div className="flex flex-col border border-[var(--color-border-secondary)] bg-[var(--color-background-white)]">
        {query.data.map((statement) => (
          <RegistryStatementRow key={statement.id} statement={statement} />
        ))}
      </div>
    </section>
  );
}

function RegistryStatementRow({
  statement,
}: {
  statement: RegistryGhgStatementView;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-12 border-b border-[var(--color-border-tertiary)] px-16 py-12 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="body-small font-mono text-[var(--color-text-primary)] truncate">
          {statement.id}
        </span>
        <span className="body-caption text-[var(--color-text-secondary)]">
          {registryStatementPeriod(statement)}
        </span>
      </div>
      <div className="flex items-center gap-12">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          {statement.removalCount} removal
          {statement.removalCount === 1 ? "" : "s"}
        </span>
        <StatusBadge status={registryStatusBadgeValue(statement.status)} />
      </div>
    </div>
  );
}

function registryStatementPeriod(statement: RegistryGhgStatementView): string {
  if (statement.startOn && statement.endOn) {
    return formatDateRange(statement.startOn, statement.endOn);
  }
  if (statement.endOn) return `Ends ${formatDate(statement.endOn)}`;
  return "No period set";
}

function registryStatusBadgeValue(
  status: RegistryGhgStatementView["status"],
): "draft" | "pending" | "verified" | "issued" | "rejected" {
  switch (status) {
    case "DRAFT":
      return "draft";
    case "AWAITING_VERIFICATION":
      return "pending";
    case "VERIFIED":
      return "verified";
    case "CREDITS_ISSUED":
      return "issued";
    case "FAILED_VERIFICATION":
      return "rejected";
  }
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

  // Same window logic as the server empty-statement guard: Isometric links
  // removals whose completion falls within [derivedStart, endOn] (derivedStart
  // is null for the first statement, where Isometric anchors to the project
  // start). Filtering only by `endOn` would predict removals Isometric then
  // excludes, so the shared util applies the lower bound too.
  const { inPeriod, outside } = partitionByWindow(
    query.data,
    derivedStart,
    endOn,
  );

  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-4 flex items-center gap-6">
        Expected contents
        <InfoHint>
          Isometric confirms membership after creation from each Removal&apos;s
          completion date. Expand a Removal to view its credit batches.
        </InfoHint>
      </h3>

      <PeriodWindow derivedStart={derivedStart} endOn={endOn} />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            Expected in this statement ({inPeriod.length})
          </span>
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Confirmed after creation.
          </span>
        </div>
        {inPeriod.length === 0 ? (
          <div className="flex items-start gap-8 border-l-2 border-[var(--color-signal-orange)] bg-[var(--st-wait-bg)] pl-12 pr-12 py-8">
            <WarningIcon
              size={16}
              weight="fill"
              aria-hidden
              className="mt-px shrink-0 text-[var(--color-signal-orange)]"
            />
            <p className="body-small text-[var(--color-text-primary)]">
              No submitted Removals fall in this period. Submit one or choose
              an end date that includes one.
            </p>
          </div>
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
          Other open removals ({outside.length})
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
        Isometric will create this period and link matching Removals.
      </p>
      <PeriodWindow derivedStart={derivedStart} endOn={endOn} />
      {isProduction ? (
        <ProductionConfirmation
          actionLabel="create this GHG Statement in the production Isometric registry"
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
  outcome,
  externalId,
  linkedCount,
  warnings,
}: {
  outcome: GhgStatementCreateOutcome;
  externalId: string;
  linkedCount: number;
  warnings: string[];
}) {
  // "existing" is the ADR 0004 idempotent path: a statement for this period was
  // already created in Isometric and this attempt resolved to it. Say that,
  // rather than claiming a creation that did not happen.
  const alreadyExisted = outcome === "existing";
  const OutcomeIcon = alreadyExisted ? InfoIcon : CheckCircleIcon;
  // Resolving to an existing statement is informational, not a success, so it
  // takes the status ramp's in-progress step rather than the success one. The
  // ramp is the semantic layer for feedback accents; `--clr-*` is the raw
  // palette and must not be reached for from a component.
  return (
    <div className="flex flex-col gap-16">
      <div
        className={`flex items-start gap-8 border-l-2 pl-12 py-4 ${
          alreadyExisted
            ? "border-[var(--st-run)]"
            : "border-[var(--st-ok)]"
        }`}
      >
        <OutcomeIcon
          size={18}
          weight="fill"
          aria-hidden
          className={`mt-px shrink-0 ${
            alreadyExisted
              ? "text-[var(--st-run)]"
              : "text-[var(--st-ok)]"
          }`}
        />
        <p className="body-small text-[var(--color-text-primary)]">
          <span className="font-mono">{externalId}</span>{" "}
          {alreadyExisted
            ? "already exists for this period, with"
            : "created with"}{" "}
          <strong className="body-small-bold">{linkedCount}</strong>{" "}
          removal{linkedCount === 1 ? "" : "s"}.
        </p>
      </div>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-8 border-l-2 border-[var(--color-signal-orange)] pl-12 py-4">
          <span className="inline-flex items-center gap-6 title-chapter-title text-[var(--color-signal-orange)]">
            <WarningIcon size={14} weight="fill" aria-hidden />
            {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
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
