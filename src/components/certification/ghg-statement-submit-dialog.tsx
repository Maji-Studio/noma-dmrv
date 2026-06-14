/**
 * GhgStatementSubmitDialog — submit (or resubmit) a GHG Statement to the
 * verifier. Keyed by `ghgStatementId`; the server resolves the statement's
 * ledger row and attaches the report document.
 */
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
}

export function GhgStatementSubmitDialog({
  ghgStatementId,
  isOpen,
  onClose,
  isProduction,
  isResubmit,
}: GhgStatementSubmitDialogProps) {
  const mutation = useSubmitGhgStatementToVerifier();
  const toast = useToast();
  const schema = buildSubmitGhgStatementDialogSchema({
    isResubmit,
    isProduction,
  });
  // The dialog stays mounted across open/close (it's rendered unconditionally
  // by the hub), so react-hook-form and react-query mutation state would
  // persist between sessions without an explicit reset. Match the
  // create-dialog pattern: reset both via the Modal's onOpen callback so the
  // form starts blank and any prior server error is cleared every open.
  const initialValues: SubmitGhgStatementDialogInput = {
    reportUrl: "",
    summaryOfChanges: isResubmit ? "" : undefined,
    confirmProduction: false,
  };
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
    setError,
  } = useForm<SubmitGhgStatementDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: initialValues,
  });

  const onModalOpen = () => {
    reset(initialValues);
    mutation.reset();
  };

  const onSubmit = handleSubmit(async (data) => {
    try {
      const result = await mutation.mutateAsync({
        ghgStatementId,
        input: {
          reportUrl: data.reportUrl,
          summaryOfChanges: data.summaryOfChanges,
          confirmProduction: data.confirmProduction,
        },
      });
      toast.success(
        `GHG statement ${result.remoteStatus.replace(/_/g, " ").toLowerCase()}.`,
      );
      onClose();
    } catch (err) {
      setError("root.serverError", {
        message: err instanceof Error ? err.message : "Submit failed",
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

          <FormField
            id="reportUrl"
            label="Report URL"
            helperText="Link to the published PDF report the verifier will open."
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
                  ? "resubmit this GHG statement to the verifier on the production Isometric registry"
                  : "submit this GHG statement to the verifier on the production Isometric registry"
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
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? "Submitting…"
                : isResubmit
                  ? "Resubmit"
                  : "Submit"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
