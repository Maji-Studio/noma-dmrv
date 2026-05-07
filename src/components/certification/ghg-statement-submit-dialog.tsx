"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { FormField, FormInput, FormTextarea, ServerError } from "@/components/forms";
import { Button } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useSubmitGhgStatementForFacility } from "@/hooks/use-certification";
import { useDialog } from "@/hooks/use-dialog";
import {
  submitGhgStatementDialogSchema,
  type SubmitGhgStatementDialogInput,
} from "@/schemas/certification";

interface GhgStatementSubmitDialogProps {
  facilityId: string;
  submissionId: string;
  isOpen: boolean;
  onClose: () => void;
  isProduction: boolean;
  isResubmit: boolean;
}

export function GhgStatementSubmitDialog({
  facilityId,
  submissionId,
  isOpen,
  onClose,
  isProduction,
  isResubmit,
}: GhgStatementSubmitDialogProps) {
  const dialogRef = useDialog(isOpen, onClose);
  const mutation = useSubmitGhgStatementForFacility();
  const toast = useToast();
  const schema = isResubmit
    ? submitGhgStatementDialogSchema.refine(
        (value) => !!value.summaryOfChanges?.trim(),
        {
          path: ["summaryOfChanges"],
          message: "Summary of changes is required",
        },
      )
    : submitGhgStatementDialogSchema;
  const {
    register,
    handleSubmit,
    formState: { errors },
    setError,
  } = useForm<SubmitGhgStatementDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: {
      reportUrl: "",
      summaryOfChanges: isResubmit ? "" : undefined,
      confirmProduction: false,
    },
  });

  if (!isOpen) return null;

  const onSubmit = handleSubmit(async (data) => {
    try {
      const result = await mutation.mutateAsync({
        facilityId,
        data: {
          submissionId,
          reportUrl: data.reportUrl,
          summaryOfChanges: data.summaryOfChanges,
          confirmProduction: data.confirmProduction,
        },
      });
      toast.success(`GHG statement ${result.remoteStatus.toLowerCase()}`);
      onClose();
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Submit failed",
      });
    }
  });

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="ghg-submit-title"
    >
      <form onSubmit={onSubmit} className="w-[520px] max-w-[calc(100vw-32px)] p-24">
        <div className="flex flex-col gap-20">
          <header>
            <h2 id="ghg-submit-title" className="title-heading-3">
              {isResubmit ? "Resubmit GHG Statement" : "Submit GHG Statement"}
            </h2>
          </header>

          <FormField
            id="reportUrl"
            label="Report URL"
            required
            error={errors.reportUrl?.message}
          >
            <FormInput
              id="reportUrl"
              type="url"
              placeholder="https://example.com/report.pdf"
              error={!!errors.reportUrl}
              {...register("reportUrl")}
            />
          </FormField>

          {isResubmit && (
            <FormField
              id="summaryOfChanges"
              label="Summary of changes"
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
            <label className="flex items-start gap-10 body-small text-[var(--color-text-secondary)]">
              <input
                type="checkbox"
                className="mt-3"
                {...register("confirmProduction")}
              />
              <span>Confirm production Isometric submission</span>
            </label>
          )}

          {errors.root?.message && <ServerError message={errors.root.message} />}

          <div className="flex justify-end gap-12">
            <Button
              type="button"
              variant="default"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Submitting..."
                : isResubmit
                  ? "Resubmit"
                  : "Submit"}
            </Button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
