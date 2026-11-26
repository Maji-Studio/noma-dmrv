"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { FormField, FormTextarea, MassMoistureFields, ResolvedErrorRevalidator } from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { FormActions } from "@/components/forms/form-actions";
import { FormEntitySelect } from "@/components/forms/entity-select/form-entity-select";
import { SERVER_ERROR_TYPE, useSaveRefusal } from "@/components/forms/use-save-refusal";
import { ChangeBlock } from "@/components/storage-locations/feedstock-loss-change";
import { useToast } from "@/components/ui/toast";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useCorrectProductionRunReturn, useRecordProductionRunReturn } from "@/hooks/use-production-run-returns";
import { deriveMassDryKg } from "@/lib/calculations/mass-dry";
import { ConflictError } from "@/lib/conflict-ref";
import { formatMassKg } from "@/lib/format-utils";
import { parseWatchedNumber } from "@/lib/mass-moisture";
import { RETURN_GRAMS_PER_KG, RETURN_OVER_CAP_MESSAGE } from "@/lib/production-run-returns/mass";
import type { ProductionRunReturnRow } from "@/data-access/production-run-returns/view";
import { returnFormSchema, type ReturnFormData, type ReturnFormInput } from "./production-run-return-schema";
import {
  AFTER_NEEDS_MASS, AFTER_NEEDS_MOISTURE, ALLOWANCE_CAPTION_AFTER, ALLOWANCE_CAPTION_BEFORE, CORRECTION_REASON_HELPER, CORRECTION_REASON_PLACEHOLDER, RETURN_ACTION_LABEL, RETURN_CONFLICT_MESSAGE,
  RETURN_DEST_EMPTY, RETURN_DRY_CAPTION, RETURN_MOISTURE_HELPER, RETURN_REASON_HELPER, RETURN_REASON_PLACEHOLDER, 
} from "./production-run-return-copy";

const CORRECTION_SUBMIT_LABEL = "Save correction";

export interface ProductionRunReturnFormProps {
  runId: string;
  facilityId: string;
  feedstockTypeId: string;
  /** Dry kg the run can still return, before this entry. */
  remainingDryKg: number;
  /** A saved return being corrected: its values fill the form and its dry mass goes back into the allowance first. */
  correction?: ProductionRunReturnRow;
  onCancel: () => void;
  onSaved: () => void;
}

/** Dry kg of an entry at its wet mass and moisture, or null until both are usable numbers. */
function dryOf(wetKg: number | null, moisturePercent: number | null): number | null {
  if (wetKg === null || moisturePercent === null || wetKg <= 0 || moisturePercent < 0 || moisturePercent >= 100) return null;
  return deriveMassDryKg(wetKg, moisturePercent);
}

/**
 * Records a failed run's return to an uncarbonized bin, or corrects one with a
 * replacement entry. Wet mass leads; the dry mass and the allowance that is left
 * follow from it. Dry solids are what the run's cap is measured in.
 */
export function ProductionRunReturnForm({ runId, facilityId, feedstockTypeId, remainingDryKg, correction, onCancel, onSaved }: ProductionRunReturnFormProps) {
  const toast = useToast();
  const clock = useFacilityClock(facilityId);
  const formId = useId();
  const record = useRecordProductionRunReturn();
  const correct = useCorrectProductionRunReturn();
  const pending = record.isPending || correct.isPending;
  // One key per open form, so a double submit replays the saved entry instead of returning twice.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, control, trigger, setError, resetField, formState: { errors } } = useForm<ReturnFormInput, unknown, ReturnFormData>({
    resolver: zodResolver(returnFormSchema),
    defaultValues: correction
      ? { storageLocationId: correction.storageLocationId, wetMassKg: correction.wetMassKg, moisturePercent: correction.moisturePercent, occurredAt: correction.occurredAt, reason: "" }
      : { storageLocationId: "", reason: "", occurredAt: new Date().toISOString() },
  });
  const refuseSave = useSaveRefusal({ control, setError, resetField, formId });
  const wetInput = useWatch({ control, name: "wetMassKg" });
  const moistureInput = useWatch({ control, name: "moisturePercent" });
  const wetKg = parseWatchedNumber(wetInput);
  const moisture = parseWatchedNumber(moistureInput);
  const returnDryKg = dryOf(wetKg, moisture);
  // A correction puts the original's dry mass back before it takes the new entry's.
  const allowanceKg = remainingDryKg + (correction?.dryMassKg ?? 0);
  const overAllowance = returnDryKg !== null && Math.round(returnDryKg * RETURN_GRAMS_PER_KG) > Math.round(allowanceKg * RETURN_GRAMS_PER_KG);
  const wetError = errors.wetMassKg?.message ?? (overAllowance ? RETURN_OVER_CAP_MESSAGE : undefined);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    if (overAllowance) {
      // Filed on the field inside the submit, so the form counts as refused and the summary lists it.
      setError("wetMassKg", { type: SERVER_ERROR_TYPE, message: RETURN_OVER_CAP_MESSAGE });
      return;
    }
    try {
      if (correction) {
        await correct.mutateAsync({ sourceProductionRunId: runId, storageLocationId: correction.storageLocationId, correctsMovementId: correction.id,
          idempotencyKey, reason: values.reason, replacement: values });
      } else {
        await record.mutateAsync({ ...values, sourceProductionRunId: runId, idempotencyKey });
      }
      toast.success(correction ? "Return corrected" : "Return saved");
      onSaved();
    } catch (error) {
      if (error instanceof ConflictError && (error.code === undefined || error.code === "conflict")) {
        // The key is spent on the saved entry; a new one lets the operator decide.
        setIdempotencyKey(crypto.randomUUID());
        setServerError(RETURN_CONFLICT_MESSAGE);
        return;
      }
      if (error instanceof Error && error.message === RETURN_OVER_CAP_MESSAGE) {
        setError("wetMassKg", { type: SERVER_ERROR_TYPE, message: error.message });
        return;
      }
      setServerError(refuseSave(error, error instanceof Error ? error.message : "The return was not saved. Check the form and try again."));
    }
  });

  const afterKg = returnDryKg === null || overAllowance ? null : allowanceKg - returnDryKg;
  // Name the gap: over the allowance, a missing moisture, or no mass yet.
  const afterFigure = afterKg !== null ? formatMassKg(afterKg)
    : returnDryKg !== null ? `Over by ${formatMassKg(returnDryKg - allowanceKg)}`
      : wetKg !== null && wetKg > 0 ? AFTER_NEEDS_MOISTURE : AFTER_NEEDS_MASS;
  return (
    <form id={formId} onSubmit={onSubmit} className="space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormEntitySelect control={control} name="storageLocationId" id="storageLocationId" label="Destination bin" entityType="storageLocation"
        placeholder="Select bin..." required disabled={pending}
        filterBy={{ facilityId, type: "feedstock_bin", uncarbonized: "true", feedstockTypeId }}
        emptyHint={RETURN_DEST_EMPTY} />
      <MassMoistureFields
        materialLabel="Returned"
        wetMassKg={wetInput}
        moisturePercent={moistureInput}
        wet={{ id: "wetMassKg", required: true, error: wetError, disabled: pending, placeholder: "e.g. 50", registration: register("wetMassKg") }}
        moisture={{ id: "moisturePercent", required: true, error: errors.moisturePercent?.message, disabled: pending, placeholder: "e.g. 30",
          helperText: RETURN_MOISTURE_HELPER, registration: register("moisturePercent") }}
      />
      <div role="group" aria-label={`${ALLOWANCE_CAPTION_BEFORE} ${formatMassKg(allowanceKg)} dry solids`} className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-8">
        <ChangeBlock label={ALLOWANCE_CAPTION_BEFORE} figure={formatMassKg(allowanceKg)} caption={RETURN_DRY_CAPTION} />
        <ArrowRightIcon size={16} aria-hidden="true" className="self-center text-[var(--color-icon-secondary)]" />
        <ChangeBlock label={ALLOWANCE_CAPTION_AFTER} figure={afterFigure} caption={RETURN_DRY_CAPTION} muted={afterKg === null} />
      </div>
      <FormField id="occurredAt" label="Date and time" required error={errors.occurredAt?.message} cue={clock.hint}>
        <EventTimeInput control={control} name="occurredAt" id="occurredAt" timeZone={clock.timeZone} disabled={pending} />
      </FormField>
      <FormField id="return-reason" label={correction ? "Why corrected" : "Reason"} required error={errors.reason?.message}
        helperText={correction ? CORRECTION_REASON_HELPER : RETURN_REASON_HELPER}>
        <FormTextarea id="return-reason" rows={3} placeholder={correction ? CORRECTION_REASON_PLACEHOLDER : RETURN_REASON_PLACEHOLDER}
          disabled={pending} error={!!errors.reason} {...register("reason")} />
      </FormField>
      <FormActions control={control} onCancel={onCancel} isSubmitting={pending} errorMessage={serverError ?? undefined}
        submitLabel={correction ? CORRECTION_SUBMIT_LABEL : RETURN_ACTION_LABEL} />
    </form>
  );
}
