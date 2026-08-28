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
import { useToast } from "@/components/ui/toast";
import {
  useGhgStatementReports,
  useSubmitGhgStatementToVerifier,
} from "@/hooks/use-certification";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import { isSubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import {
  deriveStatementStatus,
  type RemoteGhgStatus,
} from "@/lib/certification/status";
import {
  buildSubmitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import { ProductionConfirmation } from "./production-confirmation";
import {
  findApprovedGhgStatementReport,
  GhgStatementWorkflow,
} from "./ghg-statement-workflow";
import { SubmissionProgress } from "./submission-progress";

interface GhgStatementSubmitDialogProps {
  ghgStatementId: string;
  isOpen: boolean;
  onClose: () => void;
  isProduction: boolean;
  isResubmit: boolean;
  canGenerate: boolean;
  generationUnavailableReason?: string | null;
}

function registryStatusLabel(status: RemoteGhgStatus): string {
  return deriveStatementStatus({
    local: "submitted",
    lockInFlight: false,
    remoteStatus: status,
  }).label;
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
  generationUnavailableReason,
  onSubmissionPendingChange,
}: GhgStatementSubmitDialogContentProps) {
  const router = useRouter();
  const mutation = useSubmitGhgStatementToVerifier();
  const reportsQuery = useGhgStatementReports(ghgStatementId);
  const approvedReport = findApprovedGhgStatementReport(
    reportsQuery.data ?? [],
  );
  const approvedReportId = approvedReport?.id ?? null;
  const toast = useToast();
  const schema = buildSubmitGhgStatementDialogSchema({
    isResubmit,
    isProduction,
  });
  const [reportSource, setReportSource] =
    useState<"generated" | "external">("generated");
  const [progressUpdates, setProgressUpdates] = useState<
    SubmissionProgressUpdate[]
  >([]);
  const [lastInput, setLastInput] =
    useState<SubmitGhgStatementDialogInput | null>(null);
  const submissionInFlight = useRef(false);
  const initialValues: SubmitGhgStatementDialogInput = {
    reportId: approvedReportId ?? undefined,
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
  } = useForm<SubmitGhgStatementDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const runSubmission = async (input: SubmitGhgStatementDialogInput) => {
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    onSubmissionPendingChange(true);
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
      toast.success(
        `GHG Statement: ${registryStatusLabel(result.remoteStatus)}.`,
      );
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The GHG Statement was not submitted. Check the form and try again.",
      });
    } finally {
      submissionInFlight.current = false;
      onSubmissionPendingChange(false);
    }
  };

  const onSubmit = handleSubmit((data) => {
    const input: SubmitGhgStatementDialogInput = {
      reportId:
        reportSource === "generated"
          ? approvedReportId ?? undefined
          : undefined,
      externalReportUrl:
        reportSource === "external" ? data.externalReportUrl : undefined,
      summaryOfChanges: data.summaryOfChanges,
      confirmProduction: data.confirmProduction,
    };
    setLastInput(input);
    return runSubmission(input);
  });

  const serverError = errors.root?.serverError?.message ?? null;
  const isPending = mutation.isPending;
  const showProgress =
    isPending || mutation.isSuccess || mutation.isError;
  const submissionStalled = isSubmissionStreamStalledError(mutation.error);
  const displayedServerError = submissionStalled ? null : serverError;
  const reconciledStatus = mutation.data
    ? registryStatusLabel(mutation.data.remoteStatus)
    : null;
  const idleTitle = isResubmit
    ? "Resubmit GHG Statement"
    : "Submit GHG Statement";
  const dialogTitle = isPending
    ? isResubmit
      ? "Resubmitting GHG Statement"
      : "Submitting GHG Statement"
    : mutation.isSuccess
      ? isResubmit
        ? "GHG Statement resubmitted"
        : "GHG Statement submitted"
      : mutation.isError
        ? isResubmit
          ? "GHG Statement not resubmitted"
          : "GHG Statement not submitted"
        : idleTitle;

  return (
    <form onSubmit={onSubmit}>
      <div className="flex flex-col gap-20">
        <header>
          <h2 id="ghg-submit-title" className="title-heading-3">
            {dialogTitle}
          </h2>
        </header>

        {showProgress ? (
          <>
              <SubmissionProgress
                kind="ghg_statement"
                updates={progressUpdates}
                error={displayedServerError}
                stalled={submissionStalled}
              />
              {displayedServerError && (
                <ServerError message={displayedServerError} />
              )}
              <div className="flex flex-wrap items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {isPending
                    ? "noma is submitting the GHG Statement to the verifier."
                    : mutation.isSuccess && reconciledStatus
                      ? `Isometric status: ${reconciledStatus}. The reconciled status is saved in noma.`
                      : mutation.isSuccess
                        ? "The reconciled Isometric status is saved in noma."
                      : submissionStalled
                        ? "Registry work may still be continuing. Close this dialog, then use Refresh on the GHG Statement before trying again."
                        : "Completed registry operations are preserved for a safe retry."}
                </span>
                {!isPending && (
                  <div className="flex items-center gap-12">
                    {mutation.isSuccess || submissionStalled ? (
                      <Button
                        variant="primary"
                        onClick={onClose}
                      >
                        {submissionStalled ? "Close" : "Done"}
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => {
                            mutation.reset();
                            setProgressUpdates([]);
                          }}
                        >
                          Review submission
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => {
                            if (lastInput) void runSubmission(lastInput);
                          }}
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
              <div className="flex flex-col gap-12">
                <label className="flex items-start gap-8 body-small">
                  <input
                    type="radio"
                    name="reportSource"
                    checked={reportSource === "generated"}
                    onChange={() => {
                      setReportSource("generated");
                      setValue("reportId", approvedReportId ?? undefined);
                      setValue("externalReportUrl", undefined);
                    }}
                  />
                  <span>
                    <strong>Use a generated report</strong>
                    <span className="mt-2 block text-[var(--color-text-tertiary)]">
                      {approvedReportId
                        ? "The current approved report is ready to submit."
                        : "Generate, review, and approve the report before submitting."}
                    </span>
                  </span>
                </label>

                {reportSource === "generated" && (
                  <GhgStatementWorkflow
                    ghgStatementId={ghgStatementId}
                    reportsQuery={reportsQuery}
                    created
                    canManageReports
                    canGenerate={canGenerate}
                    generationUnavailableReason={generationUnavailableReason}
                    interactive
                    verifierStep={
                      approvedReportId
                        ? {
                            status: "active",
                            detail: "Submit the approved report to the verifier.",
                          }
                        : {
                            status: "skipped",
                            detail: "Approve the report before submitting it.",
                          }
                    }
                    onSubmit={
                      approvedReportId ? () => void onSubmit() : undefined
                    }
                    submitLabel={isResubmit ? "Resubmit" : "Submit"}
                  />
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
              </div>

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

              {serverError && <ServerError message={serverError} />}

              <div className="flex justify-end gap-12">
                <Button
                  type="button"
                  variant="default"
                  onClick={onClose}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                {reportSource === "external" && (
                  <Button type="submit" variant="primary">
                    {isResubmit ? "Resubmit" : "Submit"}
                  </Button>
                )}
              </div>
          </>
        )}
      </div>
    </form>
  );
}
