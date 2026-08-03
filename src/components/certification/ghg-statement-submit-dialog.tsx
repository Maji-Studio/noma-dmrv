/**
 * GhgStatementSubmitDialog — submit (or resubmit) a GHG Statement to the
 * verifier. Keyed by `ghgStatementId`; the server resolves the statement's
 * ledger row and attaches the report document.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useState } from "react";
import {
  FormField,
  FormInput,
  FormTextarea,
  ServerError,
} from "@/components/forms";
import { Button, Modal } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useSubmitGhgStatementToVerifier } from "@/hooks/use-certification";
import type { SubmissionProgressUpdate } from "@/lib/certification/submission-progress";
import { isSubmissionStreamStalledError } from "@/lib/certification/submission-progress-client";
import {
  buildSubmitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import { ProductionConfirmation } from "./production-confirmation";
import {
  canRetrySubmissionProgress,
  SubmissionProgress,
} from "./submission-progress";

interface GhgStatementSubmitDialogProps {
  ghgStatementId: string;
  isOpen: boolean;
  onClose: () => void;
  isProduction: boolean;
  isResubmit: boolean;
  approvedReportId: string | null;
}

export function GhgStatementSubmitDialog({
  ghgStatementId,
  isOpen,
  onClose,
  isProduction,
  isResubmit,
  approvedReportId,
}: GhgStatementSubmitDialogProps) {
  const mutation = useSubmitGhgStatementToVerifier();
  const toast = useToast();
  const schema = buildSubmitGhgStatementDialogSchema({
    isResubmit,
    isProduction,
  });
  const [reportSource, setReportSource] = useState<"generated" | "external">(
    approvedReportId ? "generated" : "external",
  );
  const [progressUpdates, setProgressUpdates] = useState<
    SubmissionProgressUpdate[]
  >([]);
  const [lastInput, setLastInput] =
    useState<SubmitGhgStatementDialogInput | null>(null);
  // The dialog stays mounted across open/close (it's rendered unconditionally
  // by the hub), so react-hook-form and react-query mutation state would
  // persist between sessions without an explicit reset. Match the
  // create-dialog pattern: reset both via the Modal's onOpen callback so the
  // form starts blank and any prior server error is cleared every open.
  const initialValues: SubmitGhgStatementDialogInput = {
    reportId: approvedReportId ?? undefined,
    externalReportUrl: undefined,
    summaryOfChanges: isResubmit ? "" : undefined,
    confirmProduction: false,
  };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    setError,
    setValue,
    clearErrors,
  } = useForm<SubmitGhgStatementDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const onModalOpen = () => {
    reset(initialValues);
    mutation.reset();
    setProgressUpdates([]);
    setLastInput(null);
    setReportSource(approvedReportId ? "generated" : "external");
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
      toast.success(
        `GHG Statement ${result.remoteStatus.replace(/_/g, " ").toLowerCase()}.`,
      );
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The GHG Statement was not submitted. Check the form and try again.",
      });
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
  const showProgress =
    mutation.isPending || mutation.isSuccess || mutation.isError;
  const submissionStalled = isSubmissionStreamStalledError(mutation.error);
  const canRetry =
    !submissionStalled &&
    canRetrySubmissionProgress("ghg_statement", progressUpdates);
  const idleTitle = isResubmit
    ? "Resubmit GHG Statement"
    : "Submit GHG Statement";
  const dialogTitle = mutation.isPending
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={onModalOpen}
      ariaLabelledBy="ghg-submit-title"
      width="md"
      dismissible={!mutation.isPending}
      dismissOnClickOutside={false}
    >
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
                error={serverError}
                stalled={submissionStalled}
              />
              {serverError && <ServerError message={serverError} />}
              <div className="flex flex-wrap items-center justify-between gap-12 border-t border-[var(--color-border-secondary)] pt-16">
                <span className="body-caption text-[var(--color-text-tertiary)]">
                  {mutation.isPending
                    ? "noma is submitting the GHG Statement to the verifier."
                    : mutation.isSuccess
                      ? "The verifier status is saved in noma."
                      : submissionStalled
                        ? "Registry work may still be continuing. Close this dialog and refresh the page to reconcile its status."
                      : canRetry
                        ? "Completed registry operations are preserved for a safe retry."
                        : "Review the submission details and resolve the error before submitting again."}
                </span>
                {!mutation.isPending && (
                  <div className="flex items-center gap-12">
                    {mutation.isSuccess || submissionStalled ? (
                      <Button variant="primary" onClick={onClose}>
                        {submissionStalled ? "Close" : "Done"}
                      </Button>
                    ) : canRetry && lastInput ? (
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
                          onClick={() => void runSubmission(lastInput)}
                        >
                          Try again
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="primary"
                        onClick={() => {
                          mutation.reset();
                          setProgressUpdates([]);
                        }}
                      >
                        Review submission
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-12">
                <label className="flex items-start gap-8 border border-[var(--color-border-secondary)] p-12 body-small">
                  <input
                    type="radio"
                    name="reportSource"
                    checked={reportSource === "generated"}
                    onChange={() => {
                      setReportSource("generated");
                      setValue("reportId", approvedReportId ?? undefined);
                      setValue("externalReportUrl", undefined);
                    }}
                    disabled={!approvedReportId}
                  />
                  <span>
                    <strong>Approved generated report</strong>
                    <span className="mt-2 block text-[var(--color-text-tertiary)]">
                      {approvedReportId
                        ? "Submit the current approved immutable report."
                        : "Generate and approve a report to use this option."}
                    </span>
                  </span>
                </label>

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
                  disabled={mutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  busy={mutation.isPending}
                >
                  {isResubmit ? "Resubmit" : "Submit"}
                </Button>
              </div>
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
