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
import {
  buildSubmitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";
import { ProductionConfirmation } from "./production-confirmation";

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
  } = useForm<SubmitGhgStatementDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const onModalOpen = () => {
    reset(initialValues);
    mutation.reset();
    setReportSource(approvedReportId ? "generated" : "external");
  };

  const onSubmit = handleSubmit(async (data) => {
    try {
      const result = await mutation.mutateAsync({
        ghgStatementId,
        input: {
          reportId:
            reportSource === "generated"
              ? approvedReportId ?? undefined
              : undefined,
          externalReportUrl:
            reportSource === "external"
              ? data.externalReportUrl
              : undefined,
          summaryOfChanges: data.summaryOfChanges,
          confirmProduction: data.confirmProduction,
        },
      });
      toast.success(
        `GHG Statement ${result.remoteStatus.replace(/_/g, " ").toLowerCase()}.`,
      );
      onClose();
    } catch (err) {
      setError("root.serverError", {
        message:
          err instanceof Error
            ? err.message
            : "The GHG Statement was not submitted. Check the form and try again.",
      });
    }
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      onOpen={onModalOpen}
      ariaLabelledBy="ghg-submit-title"
      width="md"
    >
      <form onSubmit={onSubmit}>
        <div className="flex flex-col gap-20">
          <header>
            <h2 id="ghg-submit-title" className="title-heading-3">
              {isResubmit ? "Resubmit GHG Statement" : "Submit GHG Statement"}
            </h2>
          </header>

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
                    : "Prepare and approve a report to use this option."}
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

          {errors.root?.serverError?.message && (
            <ServerError message={errors.root.serverError.message} />
          )}

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
        </div>
      </form>
    </Modal>
  );
}
