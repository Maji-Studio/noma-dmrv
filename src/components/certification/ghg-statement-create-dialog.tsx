"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui";
import { FormField, FormInput, ServerError } from "@/components/forms";
import { useToast } from "@/components/ui/toast";
import { useCreateGhgStatementForFacility } from "@/hooks/use-certification";
import { useDialog } from "@/hooks/use-dialog";
import {
  createGhgStatementSchema,
  type CreateGhgStatementInput,
} from "@/schemas/certification";
import { ProductionConfirmation } from "./production-confirmation";

interface GhgStatementCreateDialogProps {
  facilityId: string;
  isOpen: boolean;
  onClose: () => void;
  isProduction: boolean;
}

export function GhgStatementCreateDialog({
  facilityId,
  isOpen,
  onClose,
  isProduction,
}: GhgStatementCreateDialogProps) {
  const dialogRef = useDialog(isOpen, onClose);
  const mutation = useCreateGhgStatementForFacility();
  const toast = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
    setError,
  } = useForm<CreateGhgStatementInput>({
    resolver: zodResolver(createGhgStatementSchema),
    defaultValues: {
      endOn: new Date().toISOString().slice(0, 10),
      confirmProduction: false,
    },
  });

  useEffect(() => {
    if (!isOpen) {
      reset();
    }
  }, [isOpen, reset]);

  if (!isOpen) return null;

  const onSubmit = handleSubmit(async (data) => {
    try {
      const result = await mutation.mutateAsync({ facilityId, data });
      toast.success(`GHG statement created: ${result.externalId}`);
      onClose();
    } catch (err) {
      setError("root", {
        message: err instanceof Error ? err.message : "Create failed",
      });
    }
  });

  return (
    <dialog
      ref={dialogRef}
      className="p-0 border border-[var(--color-border-primary)] backdrop:bg-black/50"
      aria-labelledby="ghg-create-title"
    >
      <form onSubmit={onSubmit} className="w-[420px] max-w-[calc(100vw-32px)] p-24">
        <div className="flex flex-col gap-20">
          <header>
            <h2 id="ghg-create-title" className="title-heading-3">
              Create GHG Statement
            </h2>
          </header>

          <FormField
            id="endOn"
            label="Reporting period end"
            required
            error={errors.endOn?.message}
          >
            <FormInput
              id="endOn"
              type="date"
              error={!!errors.endOn}
              {...register("endOn")}
            />
          </FormField>

          {isProduction && (
            <ProductionConfirmation
              actionLabel="create a draft GHG statement on the production Isometric registry"
              registerProps={register("confirmProduction")}
            />
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
              {mutation.isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
