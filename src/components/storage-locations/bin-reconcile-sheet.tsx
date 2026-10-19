"use client";

import { FormDetailProvider, FormDetailControl } from "@/components/forms/form-detail-context";
import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { FormActions } from "@/components/forms/form-actions";
import { LOST_MASS_LABEL, LOST_MASS_SUBMIT_LABEL } from "@/lib/output-stock/labels";
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
import { numberInputConstraintsFor } from "@/lib/number-input-constraints";

/** Native min, max and step for each number input, read from the schema. */
const numberBounds = numberInputConstraintsFor(recordLossFormSchema);

/** Shown when a resubmit reuses a request key that already saved a loss. */
const LOSS_CONFLICT_MESSAGE =
  "A loss from this form is already recorded. Check the stock history before you submit again.";

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
  const clock = useFacilityClock(storageLocation.facilityId);
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
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(recordLossFormSchema),
    defaultValues: { reason: "", occurredAt: new Date().toISOString() },
  });
  const lossInput = useWatch({ control, name: "lossMassKg" });
  const reasonInput = useWatch({ control, name: "reason" });
  const lossMassKg = previewNumber(lossInput);
  // Only an entry the field schema accepts (positive, in range) previews an after figure.
  const lossPreviewKg = recordLossFormSchema.shape.lossMassKg.safeParse(lossInput).success ? lossMassKg : null;
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
        occurredAt: values.occurredAt,
        lossMassKg: values.lossMassKg,
      });
      setIdempotencyKey(crypto.randomUUID());
      toast.success("Lost mass saved");
      onRecorded?.();
    } catch (error) {
      if (error instanceof RecordLossFieldError) {
        if (error.field === "occurredAt") {
          setError("occurredAt", { type: "server", message: error.message }, { shouldFocus: true });
          return;
        }
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
      <FormField id="occurredAt" label="Date and time" required error={errors.occurredAt?.message} cue={clock.hint}>
        <EventTimeInput control={control} name="occurredAt" id="occurredAt" timeZone={clock.timeZone} disabled={recordLoss.isPending} />
      </FormField>
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
          {...numberBounds("lossMassKg")}
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
          lossKg={lossPreviewKg}
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
        submitLabel={LOST_MASS_SUBMIT_LABEL}
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
    <FormDetailProvider scope={`${open}:${storageLocation?.id}`} enabled={!!storageLocation && storageLocation.type !== "feedstock_bin"}>
    <SlideOverPanel.Root open={open} onOpenChange={onOpenChange}>
      <SlideOverPanel.Content size="default">
        <SlideOverPanel.Header showClose actions={<FormDetailControl />}>
          <div className="flex flex-col gap-4 min-w-0">
            <SlideOverPanel.Title>
              {LOST_MASS_LABEL}
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
                <OutputStockForm key={storageLocation.id} storageLocationId={storageLocation.id} facilityId={storageLocation.facilityId} onCancel={close} onRecorded={handleRecorded} />
              </> }
            </div>
          )}
        </SlideOverPanel.Body>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
    </FormDetailProvider>
  );
}
