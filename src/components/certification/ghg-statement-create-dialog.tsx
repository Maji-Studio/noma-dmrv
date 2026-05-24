/**
 * GhgStatementCreateDialog — period-first GHG Statement creation
 * A 3-step stepper: pick the reporting-period end → preview the removals
 * predicted to be linked → confirm and create. Isometric links removals to
 * the statement server-side by reporting-period date range, so the preview
 * is a *prediction* — the result panel shows what was actually reconciled.
 */
"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type UseFormRegister,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { Button, Modal } from "@/components/ui";
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

interface GhgStatementCreateDialogProps {
  facilityId: string;
  isProduction: boolean;
  isOpen: boolean;
  onClose: () => void;
}

type Step = 1 | 2 | 3;

export function GhgStatementCreateDialog({
  facilityId,
  isProduction,
  isOpen,
  onClose,
}: GhgStatementCreateDialogProps) {
  const [step, setStep] = useState<Step>(1);
  const toast = useToast();
  const mutation = useCreateGhgStatement();

  const initialValues: CreateGhgStatementInput = {
    facilityId,
    reportingPeriodEndOn: "",
    confirmProduction: false,
  };

  const {
    register,
    handleSubmit,
    watch,
    trigger,
    reset,
    setError,
    formState: { errors },
  } = useForm<CreateGhgStatementInput>({
    resolver: zodResolver(createGhgStatementSchema),
    defaultValues: initialValues,
  });

  const onModalOpen = () => {
    setStep(1);
    reset(initialValues);
    mutation.reset();
  };

  const endOn = watch("reportingPeriodEndOn");
  // The preview query only runs once the user reaches step 2.
  const openQuery = useOpenRemovalsForFacility(facilityId, isOpen && step >= 2);

  const goToPreview = async () => {
    if (await trigger("reportingPeriodEndOn")) setStep(2);
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={onModalOpen}
      ariaLabelledBy="ghg-create-title"
      width="md"
    >
      <div className="flex flex-col gap-20">
        <header className="flex flex-col gap-4">
          <span
            aria-live="polite"
            className="title-chapter-title text-[var(--color-text-tertiary)]"
          >
            {result ? "Done" : `Step ${step} of 3`}
          </span>
          <h2 id="ghg-create-title" className="title-heading-3">
            New GHG Statement
          </h2>
        </header>

        {result ? (
          <ResultPanel
            externalId={result.externalId}
            linkedCount={result.linkedRemovalIds.length}
            warnings={result.warnings}
            onClose={onClose}
          />
        ) : (
          <>
            {step === 1 && (
              <StepPeriod
                register={register}
                error={errors.reportingPeriodEndOn?.message}
              />
            )}
            {step === 2 && <StepPreview query={openQuery} endOn={endOn} />}
            {step === 3 && (
              <StepConfirm
                endOn={endOn}
                isProduction={isProduction}
                registerProps={register("confirmProduction")}
                confirmError={errors.confirmProduction?.message}
              />
            )}

            {errors.root?.serverError?.message && (
              <ServerError message={errors.root.serverError.message} />
            )}

            <div className="flex justify-between gap-12 border-t border-[var(--color-border-tertiary)] pt-16">
              <Button
                variant="default"
                onClick={onClose}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <div className="flex gap-12">
                {step > 1 && (
                  <Button
                    variant="default"
                    onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                    disabled={mutation.isPending}
                  >
                    Back
                  </Button>
                )}
                {step < 3 ? (
                  <Button
                    variant="primary"
                    onClick={step === 1 ? goToPreview : () => setStep(3)}
                    disabled={mutation.isPending}
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onClick={onCreate}
                    disabled={mutation.isPending}
                  >
                    {mutation.isPending ? "Creating…" : "Create GHG Statement"}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
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
      <p className="body-medium text-[var(--color-text-secondary)]">
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
      <p className="body-medium text-[var(--color-text-tertiary)]">
        Loading open removals…
      </p>
    );
  }
  if (query.error || !query.data) {
    return (
      <p className="body-medium text-[var(--clr-red)]">
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
            muted
              ? "flex flex-col gap-4 opacity-60"
              : "flex flex-col gap-4"
          }
        >
          {removals.map((removal) => (
            <li
              key={removal.removalId}
              className="flex items-center justify-between gap-8 border border-[var(--color-border-secondary)] px-12 py-8"
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
      <p className="body-medium text-[var(--color-text-secondary)]">
        Create a GHG Statement with reporting-period end{" "}
        <strong className="font-mono text-[var(--color-text-primary)]">
          {endOn}
        </strong>
        . Isometric will derive the period start and link the matching
        Removals.
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
  onClose,
}: {
  externalId: string;
  linkedCount: number;
  warnings: string[];
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-16">
      <p className="body-medium text-[var(--color-text-primary)]">
        GHG statement{" "}
        <span className="font-mono">{externalId}</span> created. Isometric
        linked <strong className="font-semibold">{linkedCount}</strong>{" "}
        removal(s).
      </p>
      {warnings.length > 0 && (
        <div className="flex flex-col gap-8 border-l-4 border-[var(--clr-orange-40)] bg-[var(--clr-orange-10)] px-12 py-8">
          <span className="title-chapter-title text-[var(--color-signal-orange)]">
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
      <div className="flex justify-end border-t border-[var(--color-border-tertiary)] pt-16">
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}
