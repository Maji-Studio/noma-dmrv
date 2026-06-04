/**
 * GhgStatementCreateDrawer — period-first GHG Statement creation, upgraded from
 * the old Modal stepper to the shared `StepFlow` chrome (`orientation="vertical"`)
 * inside a SlideOverPanel (Stage 5). Three steps:
 *   1. Period   — pick the reporting-period end (`end_on`, the only date the
 *                 Isometric create API accepts).
 *   2. Preview  — the removals *predicted* to be linked by completion date;
 *                 membership is decided server-side, so this is a forecast.
 *   3. Confirm  — production-gated create; the result panel shows what Isometric
 *                 actually reconciled (+ any drift warnings).
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
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import {
  useCreateGhgStatement,
  useOpenRemovalsForFacility,
} from "@/hooks/use-certification";
import {
  createGhgStatementSchema,
  type CreateGhgStatementInput,
} from "@/schemas/certification";
import type { OpenRemovalView } from "@/fn/certification/ghg-statements";
import { EnvBanner } from "./env-banner";
import { ProductionConfirmation } from "./production-confirmation";

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

export function GhgStatementCreateDrawer({
  facilityId,
  isProduction,
  open,
  onClose,
}: GhgStatementCreateDrawerProps) {
  return (
    <SlideOverPanel.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <SlideOverPanel.Content size="wide">
        {open && (
          <DrawerBody
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
  // The preview query only runs once the operator reaches the Preview step.
  const openQuery = useOpenRemovalsForFacility(facilityId, stepIndex >= 1);

  const goTo = (index: number) => {
    setStepIndex(index);
    setFurthest((f) => Math.max(f, index));
  };

  const advance = async () => {
    // Forward gate: the period must validate before previewing or confirming.
    if (stepIndex === 0 && !(await trigger("reportingPeriodEndOn"))) return;
    goTo(stepIndex + 1);
  };

  const onCreate = handleSubmit(async (data) => {
    if (isProduction && !data.confirmProduction) {
      setError("confirmProduction", {
        message: "Confirm production submission to continue",
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
            : "Period-first — Isometric links removals by date range"}
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
              />
            )}
            {stepIndex === 1 && <StepPreview query={openQuery} endOn={endOn} />}
            {stepIndex === 2 && (
              <StepConfirm
                endOn={endOn}
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

function StepPeriod({
  register,
  error,
}: {
  register: UseFormRegister<CreateGhgStatementInput>;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-12">
      <h3 className="title-heading-4">Reporting period</h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        Pick the reporting-period end date. Isometric links every Removal whose
        completion date falls in the period to this statement.
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
    </div>
  );
}

function StepPreview({
  query,
  endOn,
}: {
  query: ReturnType<typeof useOpenRemovalsForFacility>;
  endOn: string;
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
  // completion date cannot be predicted in-period. Partition in one pass.
  const inPeriod: OpenRemovalView[] = [];
  const outside: OpenRemovalView[] = [];
  for (const removal of query.data) {
    if (removal.completedOn !== null && removal.completedOn <= endOn) {
      inPeriod.push(removal);
    } else {
      outside.push(removal);
    }
  }

  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-4">Predicted removals</h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        Membership is decided server-side by Isometric and confirmed after the
        statement is created — this is a prediction by completion date.
      </p>
      <PreviewSection
        title={`Predicted to be linked (${inPeriod.length})`}
        removals={inPeriod}
        emptyText="No open removals fall on or before this date."
      />
      <PreviewSection
        title={`Open removals outside this period (${outside.length})`}
        removals={outside}
        emptyText="No other open removals."
        muted
      />
    </div>
  );
}

function PreviewSection({
  title,
  removals,
  emptyText,
  muted = false,
}: {
  title: string;
  removals: OpenRemovalView[];
  emptyText: string;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      <span className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {title}
      </span>
      {removals.length === 0 ? (
        <p className="body-caption text-[var(--color-text-tertiary)]">
          {emptyText}
        </p>
      ) : (
        <ul
          className={
            muted ? "flex flex-col gap-4 opacity-60" : "flex flex-col gap-4"
          }
        >
          {removals.map((removal) => (
            <li
              key={removal.removalId}
              className="flex items-center justify-between gap-8 border border-[var(--color-border-secondary)] bg-[var(--color-background-white)] px-12 py-8"
            >
              <span className="body-small font-mono text-[var(--color-text-secondary)] truncate">
                {removal.externalId}
              </span>
              <span className="body-caption text-[var(--color-text-tertiary)] shrink-0">
                {removal.completedOn ?? "no completion date"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StepConfirm({
  endOn,
  isProduction,
  registerProps,
  confirmError,
}: {
  endOn: string;
  isProduction: boolean;
  registerProps: UseFormRegisterReturn;
  confirmError?: string;
}) {
  return (
    <div className="flex flex-col gap-16">
      <h3 className="title-heading-4">Confirm &amp; create</h3>
      <p className="body-small text-[var(--color-text-secondary)]">
        Create a GHG Statement with reporting-period end{" "}
        <strong className="font-mono text-[var(--color-text-primary)]">
          {endOn}
        </strong>
        . Isometric will derive the period start and link the matching Removals.
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
          <strong className="font-semibold">{linkedCount}</strong> removal(s).
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
