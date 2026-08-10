"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import {
  FormField,
  FormInput,
  FormTextarea,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { useToast } from "@/components/ui/toast";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import {
  RecordLossFieldError,
  useRecordLoss,
} from "@/hooks/use-bin-movements";
import {
  laneForStorageType,
  recordLossFormSchema,
  type RecordLossFormData,
} from "@/schemas/bin-movements";
import { toNumberOrNull } from "@/schemas/helpers";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { binCurrentMassKg } from "./bin-display";
import {
  binStockOverdrawInlineMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";

interface BinReconcileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageLocation: StorageLocationWithFacility | null;
  /** Called after a movement is recorded (parent closes + toasts already fired). */
  onRecorded?: () => void;
}

/**
 * Fixed kg throughout this sheet: the current stock and recorded loss use the
 * same unit the movement history prints, so the comparison stays direct.
 */
function previewNumber(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function CurrentStockContext({
  storageLocation,
}: {
  storageLocation: StorageLocationWithFacility;
}) {
  const isFeedstock =
    laneForStorageType(storageLocation.type) === "feedstock";
  const currentMoisturePercent = isFeedstock
    ? storageLocation.feedstockInventory.estimatedMoisturePercent
    : null;

  return (
    <dl
      aria-label="Current stock context"
      className="border border-[var(--color-border-tertiary)]"
    >
      <div className="flex items-center justify-between gap-8 px-12 py-10">
        <dt className="body-caption text-[var(--color-text-tertiary)]">
          Current derived stock
        </dt>
        <dd className="body-small font-medium text-[var(--color-text-primary)]">
          {formatMassKg(binCurrentMassKg(storageLocation))}
          {isFeedstock ? " dry" : ""}
        </dd>
      </div>
      {isFeedstock && (
        <div className="flex items-center justify-between gap-8 border-t border-[var(--color-border-tertiary)] px-12 py-10">
          <dt className="body-caption text-[var(--color-text-tertiary)]">
            Current estimated moisture
          </dt>
          <dd className="body-small font-medium text-[var(--color-text-primary)]">
            {formatMoisturePercent(currentMoisturePercent)}
          </dd>
        </div>
      )}
    </dl>
  );
}

function LossForm({
  storageLocation,
  onCancel,
  onRecorded,
}: {
  storageLocation: StorageLocationWithFacility;
  onCancel: () => void;
  onRecorded?: () => void;
}) {
  const toast = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [fieldServerError, setFieldServerError] = useState<{
    message: string;
    lossMassKg: number;
  } | null>(null);
  const recordLoss = useRecordLoss();
  const lane = laneForStorageType(storageLocation.type);
  const availableKg = binCurrentMassKg(storageLocation);

  const {
    register,
    handleSubmit,
    control,
    trigger,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(recordLossFormSchema),
    defaultValues: { reason: "" },
  });
  const lossInput = useWatch({ control, name: "lossMassKg" });
  const lossMassKg = previewNumber(lossInput);
  const liveStockError =
    lossMassKg !== null &&
    isStockOverdraw(lossMassKg, availableKg)
      ? binStockOverdrawInlineMessage(lane, availableKg)
      : undefined;
  const currentFieldServerError =
    fieldServerError?.lossMassKg === lossMassKg
      ? fieldServerError.message
      : undefined;
  const lossMassError =
    errors.lossMassKg?.message ??
    liveStockError ??
    currentFieldServerError;

  const onSubmit = handleSubmit(async (raw) => {
    setServerError(null);
    if (liveStockError) return;

    const values = raw as RecordLossFormData;
    try {
      await recordLoss.mutateAsync({
        storageLocationId: storageLocation.id,
        lane,
        reason: values.reason,
        lossMassKg: values.lossMassKg,
      });
      toast.success("Loss recorded");
      onRecorded?.();
    } catch (error) {
      if (error instanceof RecordLossFieldError) {
        setFieldServerError({
          message: error.message,
          lossMassKg: values.lossMassKg,
        });
        return;
      }
      setServerError(
        error instanceof Error
          ? error.message
          : "The loss was not recorded. Check the form and try again."
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormField
        id="loss-amount"
        label="Amount lost (kg)"
        error={lossMassError}
        required
        helperText="The mass removed from the bin through spoilage, spillage, or write-off."
      >
        <FormInput
          id="loss-amount"
          type="number"
          step="any"
          min="0"
          placeholder="e.g., 50"
          disabled={recordLoss.isPending}
          error={!!lossMassError}
          {...register("lossMassKg")}
        />
      </FormField>

      <FormField
        id="loss-reason"
        label="Reason"
        error={errors.reason?.message}
        required
        helperText="What happened, such as a spoiled batch, transfer spill, or failed production run."
      >
        <FormTextarea
          id="loss-reason"
          rows={3}
          placeholder="Document the loss so a verifier knows what happened"
          disabled={recordLoss.isPending}
          error={!!errors.reason}
          {...register("reason")}
        />
      </FormField>

      <FormActions
        onCancel={onCancel}
        isSubmitting={recordLoss.isPending}
        errorMessage={serverError ?? undefined}
        submitLabel="Record loss"
      />
    </form>
  );
}

export function BinReconcileSheet({
  open,
  onOpenChange,
  storageLocation,
  onRecorded,
}: BinReconcileSheetProps) {
  const close = () => onOpenChange(false);
  const handleRecorded = () => {
    onRecorded?.();
    close();
  };

  return (
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose>
          <div className="flex flex-col gap-4 min-w-0">
            <SlideOverPanel.Title>
              {storageLocation ? `Reconcile ${storageLocation.code}` : "Reconcile"}
            </SlideOverPanel.Title>
            {storageLocation && (
              <SlideOverPanel.Description>
                {storageLocation.name}
              </SlideOverPanel.Description>
            )}
          </div>
        </SlideOverPanel.Header>

        {/* Single child: fillHeight stretches only the direct child, so the
            context and form live inside one flex column here. */}
        <SlideOverPanel.Body noPaddingBottom fillHeight>
          {storageLocation && (
            <div className="flex flex-1 flex-col gap-20">
              <CurrentStockContext storageLocation={storageLocation} />
              {/* Keyed so switching bins resets the form's state. */}
              <LossForm
                key={`loss-${storageLocation.id}`}
                storageLocation={storageLocation}
                onCancel={close}
                onRecorded={handleRecorded}
              />
            </div>
          )}
        </SlideOverPanel.Body>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
