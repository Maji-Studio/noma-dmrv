"use client";

import {
  FormField,
  FormInput,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { FormActions } from "@/components/forms/form-actions";
import { useToast } from "@/components/ui/toast";
import { useFacilityClock } from "@/hooks/use-facility-context";
import {
  RecordLossConflictError,
  RecordLossFieldError,
  useRecordLoss,
} from "@/hooks/use-bin-movements";
import { LOST_MASS_SUBMIT_LABEL } from "@/lib/output-stock/labels";
import {
  binStockOverdrawInlineMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";
import {
  recordLossFormSchema,
  type RecordLossFormData,
} from "@/schemas/bin-movements";
import { toNumberOrNull } from "@/schemas/helpers";
import type { FeedstockLedgerEntry } from "@/types/feedstock-bin-ledger";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FeedstockLossChange } from "./feedstock-loss-change";
import { LossReasonChips } from "./loss-reason-chips";

/** Shown when a resubmit reuses a request key that already saved a loss. */
const LOSS_CONFLICT_MESSAGE =
  "A loss from this form is already recorded. Check the stock history before you submit again.";
const LANE = "feedstock" as const;

function previewNumber(value: unknown): number | null {
  const parsed = toNumberOrNull(value);
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export interface FeedstockLossFormProps {
  storageLocationId: string;
  facilityId: string;
  /** Wet stock in the bin now, in kg. */
  availableKg: number | null;
  moisturePercent: number | null;
  /** The Lost mass entry being changed. Its mass goes back into the bin when the change saves. */
  correction?: FeedstockLedgerEntry;
  onCancel: () => void;
  onRecorded?: () => void;
}

/**
 * Records a feedstock bin's Lost mass, or changes one through a linked
 * reversal plus replacement. Fixed kg throughout: the stock and the loss use
 * the unit the stock history prints, so the comparison stays direct.
 */
export function FeedstockLossForm({
  storageLocationId,
  facilityId,
  availableKg,
  moisturePercent,
  correction,
  onCancel,
  onRecorded,
}: FeedstockLossFormProps) {
  const toast = useToast();
  const clock = useFacilityClock(facilityId);
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
  // A change first puts the original loss back, so it can take up to that much more.
  const restoredKg = correction?.wetDeltaKg == null ? 0 : Math.abs(correction.wetDeltaKg);
  const limitKg = availableKg === null ? null : availableKg + restoredKg;

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
    defaultValues: correction
      ? { reason: correction.reason, occurredAt: correction.occurredAt, lossMassKg: restoredKg }
      : { reason: "", occurredAt: new Date().toISOString() },
  });
  const lossInput = useWatch({ control, name: "lossMassKg" });
  const reasonInput = useWatch({ control, name: "reason" });
  const lossMassKg = previewNumber(lossInput);
  // Only an entry the field schema accepts (positive, in range) previews an after figure.
  const lossPreviewKg = recordLossFormSchema.shape.lossMassKg.safeParse(lossInput).success ? lossMassKg : null;
  const liveStockError =
    lossMassKg !== null && limitKg !== null &&
    isStockOverdraw(lossMassKg, limitKg)
      ? binStockOverdrawInlineMessage(LANE, limitKg)
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
        storageLocationId,
        lane: LANE,
        idempotencyKey,
        reason: values.reason,
        occurredAt: values.occurredAt,
        lossMassKg: values.lossMassKg,
        ...(correction ? { correctsMovementId: correction.id } : {}),
      });
      setIdempotencyKey(crypto.randomUUID());
      toast.success(correction ? "Lost mass changed" : "Lost mass saved");
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
        label="Wet mass lost"
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

      <FeedstockLossChange
        beforeKg={availableKg}
        moisturePercent={moisturePercent}
        restoredKg={restoredKg}
        lossKg={lossPreviewKg}
        blocked={!!liveStockError}
      />

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
        submitLabel={correction ? "Save changes" : LOST_MASS_SUBMIT_LABEL}
      />
    </form>
  );
}
