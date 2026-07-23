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
 * an end on or before an existing statement's end (mirrored server-side).
 *
 * Modal unmounts its children while closed, so the RHF form and mutation start
 * fresh each time.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { CheckCircleIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { Button, Modal } from "@/components/ui";
import { InfoHint } from "@/components/ui/tooltip";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import {
  useCreateGhgStatement,
  useGhgStatementsForFacility,
  useOpenRemovalsForFacility,
} from "@/hooks/use-certification";
import {
  derivePeriodStart,
  overlappingEnd,
  partitionByWindow,
} from "@/lib/isometric/utils/ghg-reporting-window";
import { formatDate } from "@/lib/format-utils";
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
      if (!(await trigger("reportingPeriodEndOn"))) return;
      const overlap = overlappingEnd(endOn, existingEnds);
      if (overlap) {
        setError("reportingPeriodEndOn", {
          message: `A statement already ends ${overlap}. Choose a later date.`,
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
        message: "Confirm creation in the live Isometric registry.",
      });
      return;
    }
    try {
      const result = await mutation.mutateAsync(data);
      if (result.warnings.length > 0) {
        toast.warning(
          `Created with ${result.warnings.length} warning${result.warnings.length === 1 ? "" : "s"}.`,
        );
      } else {
        toast.success(
          `Created with ${result.linkedRemovalIds.length} linked removal${result.linkedRemovalIds.length === 1 ? "" : "s"}.`,
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
            ? "Created in Isometric."
            : "Choose a period, preview removals, then create."}
        </p>
      </header>

      <div className="flex flex-col gap-24">
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
      </div>

      <div className="flex flex-wrap justify-end gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
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
                // On the Contents step, block advancing an empty period (#245):
                // a statement with no removals in-window would be a dead-end
                // registry record. Also wait for the preview to settle.
                disabled={stepIndex === 1 && (!previewLoaded || isEmptyPeriod)}
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
          Only the end date is sent. Isometric links submitted Removals
          completed within the period.
        </InfoHint>
      </h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        Choose the end. Isometric sets the first start; later periods begin the
        day after the previous end.
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
          {...register("reportingPeriodEndOn")}
        />
      </FormField>
      {endOn && !error && (
        <div className="flex flex-col gap-8 border-l-2 border-[var(--color-border-secondary)] pl-12">
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
        <CheckCircleIcon
          size={18}
          weight="fill"
          aria-hidden
          className="mt-px shrink-0 text-[var(--color-signal-green)]"
        />
        <p className="body-small text-[var(--color-text-primary)]">
          <span className="font-mono">{externalId}</span> created with{" "}
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
