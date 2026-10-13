"use client";

import { FormActions, FormField, FormSection, FormSpine, FormTextarea, ResolvedErrorRevalidator } from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { MoistureField, WetMassField } from "@/components/forms/mass-moisture-fields";
import { LOST_MASS_LABEL, LOST_MASS_SUBMIT_LABEL } from "@/lib/output-stock/labels";
import { usePostOutputStock } from "@/hooks/use-output-stock";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputDrawDraft } from "@/hooks/use-output-draw-draft";
import { useSubBinDraw } from "@/hooks/use-sub-bin-draw";
import { toNumberOrNull } from "@/schemas/helpers";
import { outputStockPostSchema, outputStockPreviewSchema } from "@/schemas/output-stock";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { OutputStockHistory } from "./output-stock-history";
import { OutputStockPreview } from "./output-stock-preview";
import { SubBinDrawField } from "./sub-bin-draw-field";
import { Notice } from "@/components/ui/notice";

interface Props {
  storageLocationId: string;
  facilityId: string;
  onCancel: () => void;
  onRecorded: () => void;
}

export function OutputStockForm({ storageLocationId, facilityId, onCancel, onRecorded }: Props) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const mutation = usePostOutputStock();
  const clock = useFacilityClock(facilityId);
  const { control, register, handleSubmit, setValue, trigger, formState: { errors } } = useForm({
    resolver: zodResolver(outputStockPostSchema),
    mode: "onTouched",
    defaultValues: {
      storageLocationId, facilityId, kind: "loss" as const,
      expectedProductVersions: {}, basisFingerprint: "pending-preview", idempotencyKey,
      occurredAt: new Date().toISOString(),
      wetMassKg: undefined,
      moisturePercent: null,
      reason: "",
    },
  });
  const values = useWatch({ control });
  const wetMassKg = values.wetMassKg;
  // Split losses read each reached sub-bin; mix losses use one reading.
  const draw = useSubBinDraw({ bin: { storageLocationId, facilityId }, occurredAt: values.occurredAt, wetKg: wetMassKg });
  const candidate = outputStockPreviewSchema.safeParse(draw.active
    ? { ...values, moisturePercent: null, sources: draw.sources ?? undefined }
    : { ...values, sources: undefined });
  const { preview, input, estimate, gate, beginSubmit } = useOutputDrawDraft({
    draw, singleMoistureReady: true, moisturePercent: candidate.success ? candidate.data.moisturePercent : null,
    entry: candidate.success ? candidate.data : null,
    estimateFor: { storageLocationId, facilityId, occurredAt: values.occurredAt },
    writeReadings: (sources) => setValue("sources", sources),
  });
  const { canSave, submitDisabled, basisFingerprint } = gate();
  const submit = handleSubmit(async (data) => {
    if (!input || !canSave || !basisFingerprint || !preview.data) return;
    setServerError(undefined);
    try {
      await mutation.mutateAsync({ ...input, reason: data.reason.trim(), expectedProductVersions: preview.data.expectedProductVersions, basisFingerprint, idempotencyKey });
      setIdempotencyKey(crypto.randomUUID());
      onRecorded();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Stock was not recorded. Try again.");
      void preview.refetch();
    }
  });
  return <form onSubmit={(event) => {
    event.stopPropagation();
    setAttempted(true);
    beginSubmit();
    return submit(event);
  }} className="space-y-20">
    <ResolvedErrorRevalidator control={control} trigger={trigger} />
    <FormSpine control={control}>
      <FormSection title={LOST_MASS_LABEL} fields={["occurredAt", "wetMassKg", "moisturePercent"]}>
        <FormField id="occurredAt" label="Date and time" required error={errors.occurredAt?.message} cue={clock.hint}>
          <EventTimeInput control={control} name="occurredAt" id="occurredAt" timeZone={clock.timeZone} disabled={mutation.isPending} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
          <WetMassField id="stock-wet" label="Wet mass removed (kg)" required disabled={mutation.isPending} error={errors.wetMassKg?.message} registration={register("wetMassKg", { setValueAs: toNumberOrNull })} />
          {draw.usesSingleMoisture && <MoistureField id="stock-moisture" required disabled={mutation.isPending} error={errors.moisturePercent?.message} helperText="Enter less than 100%." estimate={estimate} reading={values.moisturePercent} registration={register("moisturePercent", { setValueAs: toNumberOrNull })} />}
        </div>
        {draw.active && <SubBinDrawField draw={draw} timeZone={clock.timeZone} idPrefix="stock" disabled={mutation.isPending} showErrors={attempted} />}
        {draw.query.error && <Notice tone="error">{draw.query.error.message}</Notice>}
        {preview.isFetching && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Refreshing the stock preview</p>}
        {preview.error && <Notice tone="error">{preview.error.message}</Notice>}
        {preview.data && <OutputStockPreview variant="movement" preview={preview.data} entry={{ kind: "loss", wetMassKg: input?.wetMassKg }} moreInfo={<OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} />} renderBlocker={blocker => blocker.entity === "binMovement" ? <OutputStockHistory key={blocker.id} storageLocationId={storageLocationId} facilityId={facilityId} movementId={blocker.id} triggerLabel={`Open ${blocker.code}`} /> : undefined} />}
      </FormSection>
      <FormSection title="Reason" fields={["reason"]}>
        <FormField id="stock-reason" label="Reason" required error={errors.reason?.message}>
          <FormTextarea disabled={mutation.isPending} id="stock-reason" {...register("reason")} />
        </FormField>
      </FormSection>
    </FormSpine>
    <FormActions control={control} onCancel={onCancel} isSubmitting={mutation.isPending} errorMessage={serverError} submitDisabled={submitDisabled} submitLabel={LOST_MASS_SUBMIT_LABEL} />
  </form>;
}
