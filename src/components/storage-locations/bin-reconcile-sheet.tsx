"use client";

import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { SegmentedControl } from "@/components/forms/segmented-control";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { useToast } from "@/components/ui/toast";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import {
  RecordLossConflictError,
  RecordLossFieldError,
  useRecordLoss,
} from "@/hooks/use-bin-movements";
import {
  binStockOverdrawInlineMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";
import {
  laneForStorageType,
  recordLossFormSchema,
  type RecordLossFormData,
} from "@/schemas/bin-movements";
import { toNumberOrNull } from "@/schemas/helpers";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { binCurrentMassKg } from "./bin-display";
import { OutputStockForm } from "./output-stock-form";
import { FeedstockLossChange } from "./feedstock-loss-change";
import { LossReasonChips } from "./loss-reason-chips";

/** Shown when a resubmit reuses a request key that already saved a loss. */
const LOSS_CONFLICT_MESSAGE =
  "A loss from this form is already recorded. Check the reconciliation history before you submit again.";

type OutputKind = "loss" | "count";

const MOVEMENT_OPTIONS = [
  { value: "loss", label: "Record loss" },
  { value: "count", label: "Reconcile stock" },
] as const;

interface BinReconcileSheetProps {
  initialKind?: OutputKind;
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
  // One key per open form instance, so a double submit replays the saved
  // movement instead of posting a second deduction.
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const lane = laneForStorageType(storageLocation.type);
  const availableKg = binCurrentMassKg(storageLocation);

  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(recordLossFormSchema),
    defaultValues: { reason: "" },
  });
  const lossInput = useWatch({ control, name: "lossMassKg" });
  const reasonInput = useWatch({ control, name: "reason" });
  const lossMassKg = previewNumber(lossInput);
  const liveStockError =
    lossMassKg !== null && availableKg !== null &&
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
        idempotencyKey,
        reason: values.reason,
        lossMassKg: values.lossMassKg,
      });
      setIdempotencyKey(crypto.randomUUID());
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
      if (error instanceof RecordLossConflictError) {
        // The key is spent on the saved movement, so an edited resubmit would
        // conflict again. Rotate it and let the operator decide.
        setIdempotencyKey(crypto.randomUUID());
        setServerError(LOSS_CONFLICT_MESSAGE);
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
        label={lane === "feedstock" ? "Wet mass lost" : "Amount lost"}
        unit="kg"
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

      {lane === "feedstock" && (
        <FeedstockLossChange
          beforeKg={availableKg}
          moisturePercent={storageLocation.feedstockInventory.estimatedMoisturePercent}
          lossKg={lossMassKg}
          blocked={!!liveStockError}
        />
      )}

      <FormField
        id="loss-reason"
        label="Reason"
        error={errors.reason?.message}
        required
        helperText="What happened, such as a spoiled batch, transfer spill, or failed production run."
      >
        <LossReasonChips
          id="loss-reason"
          rows={3}
          value={reasonInput ?? ""}
          onPick={(next) => setValue("reason", next, { shouldDirty: true, shouldValidate: true })}
          placeholder="Document the loss so a verifier knows what happened"
          disabled={recordLoss.isPending}
          error={!!errors.reason}
          {...register("reason")}
        />
      </FormField>

      <FormActions
        control={control}
        onCancel={onCancel}
        isSubmitting={recordLoss.isPending}
        errorMessage={serverError ?? undefined}
        submitLabel="Record loss"
      />
    </form>
  );
}

export function BinReconcileSheet({
  initialKind = "count",
  open,
  onOpenChange,
  storageLocation,
  onRecorded,
}: BinReconcileSheetProps) {
  const [outputKind, setOutputKind] = useState<OutputKind>(initialKind);
  const close = () => onOpenChange(false);
  const handleRecorded = () => {
    onRecorded?.();
    close();
  };

  return (
    <FormDetailProvider scope={`${open}:${storageLocation?.id}:${outputKind}`} enabled={!!storageLocation && storageLocation.type !== "feedstock_bin"}>
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose actions={<FormDetailControl />}>
          <div className="flex flex-col gap-4 min-w-0">
            <SlideOverPanel.Title>
              {storageLocation ? `Reconcile ${storageLocation.code}` : "Reconcile"}
            </SlideOverPanel.Title>
            {storageLocation && (
              <SlideOverPanel.Description className="truncate">
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
              {storageLocation.type === "feedstock_bin" ? <>
              {/* Keyed so switching bins resets the form's state. */}
              <LossForm
                key={`loss-${storageLocation.id}`}
                storageLocation={storageLocation}
                onCancel={close}
                onRecorded={handleRecorded}
              />
              </> : <>
                {/* Which mode the sheet is in has to be readable at a glance:
                    the two forms differ only in their labels otherwise. */}
                <SegmentedControl
                  legend="Movement to record"
                  options={MOVEMENT_OPTIONS}
                  value={outputKind}
                  onValueChange={(next) => setOutputKind(next as OutputKind)}
                />
                <OutputStockForm key={`${storageLocation.id}-${outputKind}`} storageLocationId={storageLocation.id} facilityId={storageLocation.facilityId} kind={outputKind} onCancel={close} onRecorded={handleRecorded} />
              </> }
            </div>
          )}
        </SlideOverPanel.Body>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
    </FormDetailProvider>
  );
}
