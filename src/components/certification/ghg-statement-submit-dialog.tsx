/**
 * GhgStatementSubmitDialog — submit (or resubmit) a GHG Statement to the
 * verifier. Keyed by `ghgStatementId`; the server resolves the statement's
 * ledger row and attaches the report document.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FormField,
  FormInput,
  FormTextarea,
  ServerError,
} from "@/components/forms";
import { Button, Modal } from "@/components/ui";
import { StepFlow, type StepFlowStep } from "@/components/ui/step-flow";
import { useToast } from "@/components/ui/toast";
import type { GhgStatementReportView } from "@/fn/certification/ghg-statement-reports";
import {
  useApproveGhgStatementReport,
  useGhgStatementBreakdown,
  usePrepareGhgStatementReport,
  useSubmitGhgStatementToVerifier,
} from "@/hooks/use-certification";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import { isSubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import {
  deriveStatementStatus,
  type RemoteGhgStatus,
} from "@/lib/certification/status";
import { formatCount } from "@/lib/copy-utils";
import { formatDate, formatDateRange } from "@/lib/format-utils";
import {
  buildSubmitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogFormInput,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import { GhgStatementCarbonBreakdown } from "./ghg-statement-carbon-breakdown";
import { ProductionConfirmation } from "./production-confirmation";
import { SubmissionProgress } from "./submission-progress";

const STEPS: StepFlowStep[] = [
  { key: "report", label: "Report", description: "Choose the attachment" },
  { key: "review", label: "Review", description: "Preview and submit" },
];
const REPORT_STEP_INDEX = 0;
const REVIEW_STEP_INDEX = 1;

interface GhgStatementSubmitDialogProps {
  ghgStatementId: string;
  isOpen: boolean;
  onClose: () => void;
  isProduction: boolean;
  isResubmit: boolean;
  canGenerate: boolean;
  canSubmit?: boolean;
  generationUnavailableReason?: string | null;
}

function registryStatus(status: RemoteGhgStatus) {
  return deriveStatementStatus({
    local: "submitted",
    lockInFlight: false,
    remoteStatus: status,
  });
}

function needsSubmissionReview(
  status: ReturnType<typeof registryStatus> | null,
): boolean {
  return (
    status?.kind === "in-registry" || status?.kind === "verification-failed"
  );
}

export function GhgStatementSubmitDialog({
  isOpen,
  onClose,
  ...props
}: GhgStatementSubmitDialogProps) {
  const [submissionPending, setSubmissionPending] = useState(false);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabelledBy="ghg-submit-title"
      width="md"
      dismissible={!submissionPending}
      dismissOnClickOutside={false}
    >
      <GhgStatementSubmitDialogContent
        {...props}
        onClose={onClose}
        onSubmissionPendingChange={setSubmissionPending}
      />
    </Modal>
  );
}

type GhgStatementSubmitDialogContentProps = Omit<
  GhgStatementSubmitDialogProps,
  "isOpen"
> & {
  onSubmissionPendingChange: (pending: boolean) => void;
};

function GhgStatementSubmitDialogContent({
  ghgStatementId,
  onClose,
  isProduction,
  isResubmit,
  canGenerate,
  canSubmit = true,
  generationUnavailableReason,
  onSubmissionPendingChange,
}: GhgStatementSubmitDialogContentProps) {
  const router = useRouter();
  const mutation = useSubmitGhgStatementToVerifier();
  const prepareReport = usePrepareGhgStatementReport();
  const approveReport = useApproveGhgStatementReport();
  const breakdownQuery = useGhgStatementBreakdown(ghgStatementId);
  const toast = useToast();
  const schema = buildSubmitGhgStatementDialogSchema({
    isResubmit,
    isProduction,
  });
  const [stepIndex, setStepIndex] = useState(REPORT_STEP_INDEX);
  const [reportSource, setReportSource] =
    useState<"generated" | "external">("generated");
  const [preparationKey, setPreparationKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [preparedReport, setPreparedReport] =
    useState<GhgStatementReportView | null>(null);
  const [preparedReportKey, setPreparedReportKey] = useState<string | null>(
    null,
  );
  const [reviewedReportId, setReviewedReportId] = useState<string | null>(null);
  const [progressUpdates, setProgressUpdates] = useState<
    SubmissionProgressUpdate[]
  >([]);
  const [lastInput, setLastInput] =
    useState<SubmitGhgStatementDialogInput | null>(null);
  const submissionInFlight = useRef(false);
  const initialValues: SubmitGhgStatementDialogFormInput = {
    reportSource: "generated",
    reportId: undefined,
    externalReportUrl: undefined,
    summaryOfChanges: isResubmit ? "" : undefined,
    confirmProduction: false,
  };
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
    setValue,
    clearErrors,
    getValues,
    trigger,
  } = useForm<SubmitGhgStatementDialogFormInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const beginSubmission = () => {
    if (!canSubmit || submissionInFlight.current) return false;
    submissionInFlight.current = true;
    onSubmissionPendingChange(true);
    return true;
  };

  const finishSubmission = () => {
    submissionInFlight.current = false;
    onSubmissionPendingChange(false);
  };

  const runSubmission = async (input: SubmitGhgStatementDialogInput) => {
    try {
      setProgressUpdates([]);
      clearErrors("root.serverError");
      const result = await mutation.mutateAsync({
        ghgStatementId,
        input,
        onProgress: (update) => {
          setProgressUpdates((current) => [...current, update]);
        },
      });
      router.refresh();
      const resultStatus = registryStatus(result.remoteStatus);
      const resultMessage = `GHG Statement: ${resultStatus.label}.`;
      if (resultStatus.kind === "verification-failed") {
        toast.error(resultMessage);
      } else if (resultStatus.kind === "in-registry") {
        toast.warning(resultMessage);
      } else {
        toast.success(resultMessage);
      }
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The GHG Statement was not submitted. Check the form and try again.",
      });
    }
  };

  const onSubmit = handleSubmit(async (data) => {
    if (
      reportSource === "generated" &&
      (!preparedReport ||
        !preparedReportKey ||
        reviewedReportId !== preparedReport.id)
    ) {
      setError("root.serverError", {
        message: "Open the prepared report and review it before approval.",
      });
      return;
    }
    if (!beginSubmission()) return;
    try {
      clearErrors("root.serverError");
      let reportId: string | undefined;
      if (
        reportSource === "generated" &&
        preparedReport &&
        preparedReportKey
      ) {
        let approved = preparedReport;
        if (preparedReport.lifecycle === "prepared") {
          try {
            approved = await approveReport.mutateAsync({
              ghgStatementId,
              reportId: preparedReport.id,
              version: preparedReport.version,
            });
          } catch (approvalError) {
            const reconciled = await prepareReport.mutateAsync({
              ghgStatementId,
              preparationKey: preparedReportKey,
            });
            if (
              reconciled.id !== preparedReport.id ||
              reconciled.version !== preparedReport.version ||
              reconciled.lifecycle === "prepared"
            ) {
              throw approvalError;
            }
            approved = reconciled;
          }
        }
        setPreparedReport(approved);
        reportId = approved.id;
      }
      const input: SubmitGhgStatementDialogInput = {
        reportId,
        externalReportUrl:
          reportSource === "external" ? data.externalReportUrl : undefined,
        summaryOfChanges: data.summaryOfChanges,
        confirmProduction: data.confirmProduction,
      };
      setLastInput(input);
      await runSubmission(input);
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The report was not prepared. Check the preview and try again.",
      });
    } finally {
      finishSubmission();
    }
  });

  const retrySubmission = async () => {
    if (!lastInput || !beginSubmission()) return;
    try {
      await runSubmission(lastInput);
    } finally {
      finishSubmission();
    }
  };

  const generatedPreviewReady =
    canGenerate && breakdownQuery.data?.status === "available";
  const generatedUnavailableMessage = !canGenerate
    ? (generationUnavailableReason ?? "The report cannot be prepared yet.")
    : breakdownQuery.data?.status === "unavailable"
      ? breakdownQuery.data.message
      : breakdownQuery.isLoading
        ? "The report preview is still loading."
        : "The report preview is unavailable. Refresh the statement and try again.";

  const advance = async () => {
    if (!canSubmit) return;
    clearErrors("root.serverError");
    if (reportSource === "generated" && !generatedPreviewReady) return;
    const submissionFields: ("summaryOfChanges" | "confirmProduction")[] = [];
    if (isResubmit) submissionFields.push("summaryOfChanges");
    if (isProduction) submissionFields.push("confirmProduction");
    if (submissionFields.length > 0 && !(await trigger(submissionFields))) return;
    if (reportSource === "external") {
      if (!(await trigger("externalReportUrl"))) return;
      setStepIndex(REVIEW_STEP_INDEX);
      return;
    }
    if (!beginSubmission()) return;
    try {
      const report = await prepareReport.mutateAsync({
        ghgStatementId,
        preparationKey,
      });
      setPreparedReport(report);
      setPreparedReportKey(preparationKey);
      setReviewedReportId(null);
      setStepIndex(REVIEW_STEP_INDEX);
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The report was not prepared. Check the preview and try again.",
      });
    } finally {
      finishSubmission();
    }
  };

  const returnToReportStep = () => {
    setPreparedReport(null);
    setPreparedReportKey(null);
    setReviewedReportId(null);
    setPreparationKey(crypto.randomUUID());
    setStepIndex(REPORT_STEP_INDEX);
  };

  const serverError = errors.root?.serverError?.message ?? null;
  const isPending = mutation.isPending;
  const showProgress = isPending || mutation.isSuccess || mutation.isError;
  const reportPreparationPending =
    prepareReport.isPending || approveReport.isPending;
  const submissionPending = reportPreparationPending || isPending;
  const submissionStalled = isSubmissionStreamStalledError(mutation.error);
  const displayedServerError = submissionStalled ? null : serverError;
  const reconciledStatus = mutation.data
    ? registryStatus(mutation.data.remoteStatus)
    : null;
  const resultNeedsReview = reconciledStatus?.kind === "in-registry";
  const verificationFailed =
    reconciledStatus?.kind === "verification-failed";
  const resultNeedsAction = needsSubmissionReview(reconciledStatus);
  const showSubmissionProgress = !(mutation.isSuccess && resultNeedsAction);
  const idleTitle = isResubmit
    ? "Resubmit GHG Statement"
    : "Submit GHG Statement";
  const dialogTitle = reportPreparationPending
    ? "Preparing GHG Statement submission"
    : isPending
      ? isResubmit
        ? "Resubmitting GHG Statement"
        : "Submitting GHG Statement"
      : mutation.isSuccess
        ? reconciledStatus?.kind === "in-registry"
          ? "GHG Statement not submitted"
          : reconciledStatus?.kind === "verification-failed"
            ? "GHG Statement verification failed"
            : isResubmit
              ? "GHG Statement resubmitted"
              : "GHG Statement submitted"
        : mutation.isError
          ? isResubmit
            ? "GHG Statement not resubmitted"
            : "GHG Statement not submitted"
          : idleTitle;

  return (
    <form
      onSubmit={(event) => {
        if (stepIndex === REPORT_STEP_INDEX) {
          event.preventDefault();
          void advance();
          return;
        }
        void onSubmit(event);
      }}
    >
      <div className="flex flex-col gap-20">
        <header>
          <h2 id="ghg-submit-title" className="title-heading-3">
            {dialogTitle}
          </h2>
        </header>

        {showProgress ? (
          <>
            {showSubmissionProgress && (
              <SubmissionProgress
                kind="ghg_statement"
                updates={progressUpdates}
                error={displayedServerError}
                stalled={submissionStalled}
              />
            )}
            {displayedServerError && (
              <ServerError message={displayedServerError} />
            )}
            <div className="flex flex-wrap items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
              <span className="body-caption text-[var(--color-text-tertiary)]">
                {isPending
                  ? "noma is submitting the GHG Statement to the verifier."
                  : mutation.isSuccess && reconciledStatus
                    ? verificationFailed
                      ? "Isometric status: Verification failed. Update the Removals, close this dialog, then use Refresh on the GHG Statement before resubmitting."
                      : resultNeedsReview
                        ? `Isometric status: ${reconciledStatus.label}. Review the submission before trying again.`
                        : `Isometric status: ${reconciledStatus.label}. The reconciled status is saved in noma.`
                    : mutation.isSuccess
                      ? "The reconciled Isometric status is saved in noma."
                      : submissionStalled
                        ? "Registry work may still be continuing. Close this dialog, then use Refresh on the GHG Statement before trying again."
                        : "Completed registry operations are preserved for a safe retry."}
              </span>
              {!isPending && (
                <div className="flex items-center gap-12">
                  {mutation.isSuccess && resultNeedsReview ? (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={() => {
                        mutation.reset();
                        setProgressUpdates([]);
                      }}
                    >
                      Review submission
                    </Button>
                  ) : mutation.isSuccess || submissionStalled ? (
                    <Button type="button" variant="primary" onClick={onClose}>
                      {submissionStalled || verificationFailed
                        ? "Close"
                        : "Done"}
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        onClick={() => {
                          mutation.reset();
                          setProgressUpdates([]);
                        }}
                      >
                        Review submission
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={() => void retrySubmission()}
                      >
                        Try again
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {!canSubmit && generationUnavailableReason && (
              <p
                className="border-l-2 border-[var(--color-signal-orange)] bg-[var(--color-signal-orange-light)] px-12 py-8 body-small text-[var(--color-signal-orange-strong)]"
                role="status"
              >
                {generationUnavailableReason}
              </p>
            )}
            <StepFlow
              orientation="vertical"
              steps={STEPS}
              current={stepIndex}
              furthest={stepIndex}
              onNavigate={(index) => setStepIndex(index)}
              footer={
                <div className="flex flex-wrap justify-end gap-12">
                  <Button
                    type="button"
                    variant="default"
                    onClick={onClose}
                    disabled={submissionPending}
                  >
                    Cancel
                  </Button>
                  {stepIndex === REVIEW_STEP_INDEX && (
                    <Button
                      type="button"
                      variant="default"
                      onClick={returnToReportStep}
                      disabled={submissionPending}
                    >
                      Back
                    </Button>
                  )}
                  {stepIndex === REPORT_STEP_INDEX ? (
                    <Button
                      type="button"
                      variant="primary"
                      onClick={advance}
                      disabled={
                        !canSubmit ||
                        (reportSource === "generated" &&
                          !generatedPreviewReady)
                      }
                    >
                      Next
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      variant="primary"
                      busy={submissionPending}
                      disabled={
                        !canSubmit ||
                        (reportSource === "generated" &&
                          (!preparedReport ||
                            reviewedReportId !== preparedReport.id))
                      }
                    >
                      {reportSource === "generated"
                        ? isResubmit
                          ? "Approve and resubmit"
                          : "Approve and submit"
                        : isResubmit
                          ? "Resubmit"
                          : "Submit"}
                    </Button>
                  )}
                </div>
              }
            >
              {stepIndex === REPORT_STEP_INDEX ? (
                <div className="flex flex-col gap-12">
                  <label className="flex items-start gap-8 body-small">
                    <input
                      type="radio"
                      name="reportSource"
                      checked={reportSource === "generated"}
                      onChange={() => {
                        setReportSource("generated");
                        setValue("reportSource", "generated");
                        setValue("reportId", undefined);
                        setValue("externalReportUrl", undefined);
                        clearErrors("externalReportUrl");
                      }}
                    />
                    <span>
                      <strong>Generate and attach automatically</strong>
                      <span className="mt-2 block text-[var(--color-text-tertiary)]">
                        noma creates the controlled report from current
                        Isometric data when you submit.
                      </span>
                    </span>
                  </label>

                  {reportSource === "generated" &&
                    canSubmit &&
                    !generatedPreviewReady && (
                      <p
                        className="body-caption text-[var(--color-text-secondary)]"
                        role="status"
                      >
                        {generatedUnavailableMessage}
                      </p>
                    )}

                  <details className="border border-[var(--color-border-secondary)] p-12">
                    <summary className="body-small cursor-pointer">
                      Advanced: VVB or project-supplied controlled document
                    </summary>
                    <div className="mt-12 flex flex-col gap-12">
                      <label className="flex items-start gap-8 body-small">
                        <input
                          type="radio"
                          name="reportSource"
                          checked={reportSource === "external"}
                          onChange={() => {
                            setReportSource("external");
                            setValue("reportSource", "external");
                            setValue("reportId", undefined);
                          }}
                        />
                        Use an external HTTPS report URL
                      </label>
                      {reportSource === "external" && (
                        <FormField
                          id="externalReportUrl"
                          label="External report URL"
                          helperText="The verifier must be able to open this controlled document."
                          required
                          error={errors.externalReportUrl?.message}
                        >
                          <FormInput
                            id="externalReportUrl"
                            type="url"
                            placeholder="https://example.com/report.pdf"
                            error={!!errors.externalReportUrl}
                            {...register("externalReportUrl")}
                          />
                        </FormField>
                      )}
                    </div>
                  </details>

                  {isResubmit && (
                    <FormField
                      id="summaryOfChanges"
                      label="Summary of changes"
                      helperText="What you changed since the last submission, for the verifier."
                      required
                      error={errors.summaryOfChanges?.message}
                    >
                      <FormTextarea
                        id="summaryOfChanges"
                        error={!!errors.summaryOfChanges}
                        {...register("summaryOfChanges")}
                      />
                    </FormField>
                  )}

                  {isProduction && (
                    <ProductionConfirmation
                      actionLabel={
                        isResubmit
                          ? "resubmit this GHG Statement to the verifier on the production Isometric registry"
                          : "submit this GHG Statement to the verifier on the production Isometric registry"
                      }
                      registerProps={register("confirmProduction")}
                      errorMessage={errors.confirmProduction?.message}
                    />
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-16">
                  {reportSource === "generated" && preparedReport ? (
                    <GeneratedReportPreview
                      query={breakdownQuery}
                      report={preparedReport}
                      reviewed={reviewedReportId === preparedReport.id}
                      onReview={() => setReviewedReportId(preparedReport.id)}
                    />
                  ) : (
                    <ExternalReportPreview
                      url={getValues("externalReportUrl") ?? ""}
                    />
                  )}

                </div>
              )}
            </StepFlow>
            {serverError && <ServerError message={serverError} />}
          </>
        )}
      </div>
    </form>
  );
}

function GeneratedReportPreview({
  query,
  report,
  reviewed,
  onReview,
}: {
  query: ReturnType<typeof useGhgStatementBreakdown>;
  report: GhgStatementReportView;
  reviewed: boolean;
  onReview: () => void;
}) {
  const data = query.data?.status === "available" ? query.data.value : null;
  const period = data
    ? data.reportingPeriodStartOn
      ? formatDateRange(
          data.reportingPeriodStartOn,
          data.reportingPeriodEndOn,
        )
      : `Ends ${formatDate(data.reportingPeriodEndOn)}`
    : null;

  return (
    <section className="flex flex-col gap-12" aria-labelledby="report-preview">
      <div className="flex flex-col gap-4">
        <h3 id="report-preview" className="body-large font-medium">
          Submission preview
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          Open and review the exact frozen PDF before approving version{" "}
          {report.version} for submission.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-12 border-y border-[var(--color-border-secondary)] py-12">
        <span className="body-small text-[var(--color-text-secondary)]">
          {reviewed
            ? `Version ${report.version} opened for review.`
            : `Version ${report.version} must be reviewed before approval.`}
        </span>
        <a
          href={report.reviewUrl}
          target="_blank"
          rel="noreferrer"
          onClick={onReview}
          className="body-small font-medium text-[var(--color-interaction)] underline underline-offset-2"
        >
          Review report
        </a>
      </div>

      {data && (
        <dl className="grid grid-cols-1 gap-12 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <dt className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Reporting period
            </dt>
            <dd className="body-small text-[var(--color-text-primary)]">
              {period}
            </dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
              Contents
            </dt>
            <dd className="body-small text-[var(--color-text-primary)]">
              {formatCount(data.memberRemovalCount, "Removal")}
            </dd>
          </div>
        </dl>
      )}

      <GhgStatementCarbonBreakdown query={query} />
    </section>
  );
}

function ExternalReportPreview({ url }: { url: string }) {
  return (
    <section className="flex flex-col gap-8" aria-labelledby="report-preview">
      <div className="flex flex-col gap-4">
        <h3 id="report-preview" className="body-large font-medium">
          Submission preview
        </h3>
        <p className="body-small text-[var(--color-text-secondary)]">
          noma attaches this controlled document when you submit.
        </p>
      </div>
      <dl className="border-y border-[var(--color-border-secondary)] py-12">
        <div className="flex flex-col gap-2">
          <dt className="body-caption uppercase tracking-wide text-[var(--color-text-tertiary)]">
            External report URL
          </dt>
          <dd className="body-small break-all font-mono text-[var(--color-text-primary)]">
            {url}
          </dd>
        </div>
      </dl>
    </section>
  );
}
