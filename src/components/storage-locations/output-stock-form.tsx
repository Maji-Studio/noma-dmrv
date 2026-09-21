"use client";

import { FormActions, FormField, FormInput, FormSection, FormSpine, FormTextarea, ResolvedErrorRevalidator } from "@/components/forms";
import { MoistureField, WetMassField } from "@/components/forms/mass-moisture-fields";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { useOutputStockPreview, usePostOutputStock } from "@/hooks/use-output-stock";
import { formatLocalDate } from "@/lib/date-utils";
import { formatDate, formatMassKg } from "@/lib/format-utils";
import { toNumberOrNull } from "@/schemas/helpers";
import { outputStockPostSchema, outputStockPreviewSchema } from "@/schemas/output-stock";
import type { OutputStockHistoryEntry, OutputStockPreviewInput } from "@/types/output-stock";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { OutputStockHistory } from "./output-stock-history";
import { OutputStockAllocations, OutputStockPreview } from "./output-stock-preview";

interface Props {
  storageLocationId: string;
  facilityId: string;
  kind: OutputStockPreviewInput["kind"];
  original?: OutputStockHistoryEntry;
  onCancel: () => void;
  onRecorded: () => void;
}

export function OutputStockForm({ storageLocationId, facilityId, kind, original, onCancel, onRecorded }: Props) {
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [serverError, setServerError] = useState<string>();
  const mutation = usePostOutputStock();
  const { control, register, handleSubmit, trigger, formState: { errors } } = useForm({
    resolver: zodResolver(outputStockPostSchema),
    mode: "onTouched",
    defaultValues: {
      storageLocationId, facilityId, kind, correctsMovementId: original?.id,
      basisFingerprint: "pending-preview", idempotencyKey,
      physicalDate: original?.physicalDate.slice(0, 10) ?? formatLocalDate(new Date()),
      wetMassKg: original?.wetMassKg ?? undefined,
      moisturePercent: original?.moisturePercent ?? null,
      reason: "",
    },
  });
  const values = useWatch({ control });
  const wetMassKg = values.wetMassKg;
  const candidate = outputStockPreviewSchema.safeParse({ ...values, moisturePercent: kind === "count" && wetMassKg === 0 ? null : values.moisturePercent });
  const input = candidate.success ? candidate.data : null;
  const preview = useOutputStockPreview(input);
  const submit = handleSubmit(async (data) => {
    if (!input || !preview.data || preview.isFetching || preview.data.blockingMessage) return;
    setServerError(undefined);
    try {
      await mutation.mutateAsync({ ...input, reason: data.reason.trim(), basisFingerprint: preview.data.basisFingerprint, idempotencyKey });
      setIdempotencyKey(crypto.randomUUID());
      onRecorded();
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Stock was not recorded. Try again.");
      void preview.refetch();
    }
  });
  return <form onSubmit={(event) => { event.stopPropagation(); return submit(event); }} className="space-y-20">
    <ResolvedErrorRevalidator control={control} trigger={trigger} />
    <FormSpine control={control}>
      {original && <FormSection title="Original entry">
        <p className="body-small">{outputStockEventLabel(original.kind)} on {formatDate(original.physicalDate)}. {formatMassKg(original.beforeDryKg)} before, {formatMassKg(original.afterDryKg)} after, dry biochar.</p>
        <OutputStockAllocations allocations={original.allocations} />
      </FormSection>}
      <FormSection title={original ? "Proposed replacement" : kind === "count" ? "Reconcile stock" : "Record loss"} fields={["physicalDate", "wetMassKg", "moisturePercent"]}>
        <FormField id="physicalDate" label="Physical date" required error={errors.physicalDate?.message}>
          <FormInput disabled={mutation.isPending} id="physicalDate" type="date" {...register("physicalDate", { required: "Enter the physical date." })} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
          <WetMassField id="stock-wet" label={kind === "count" ? "Counted wet mass (kg)" : "Wet mass removed (kg)"} required disabled={mutation.isPending} error={errors.wetMassKg?.message} registration={register("wetMassKg", { setValueAs: toNumberOrNull })} />
          <MoistureField id="stock-moisture" required={!(kind === "count" && wetMassKg === 0)} disabled={mutation.isPending} error={errors.moisturePercent?.message} helperText="Enter less than 100%. A zero count does not need moisture." registration={register("moisturePercent", { setValueAs: toNumberOrNull })} />
        </div>
        <p className="body-caption">Drying alone does not remove dry biochar. A count above tracked solids records a discrepancy without adding stock.</p>
      </FormSection>
      <FormSection title="Stock preview">
        {preview.isFetching && <p role="status">Refreshing stock preview...</p>}
        {preview.error && <p role="alert">{preview.error.message}</p>}
        {preview.data && <OutputStockPreview followFormDetail preview={preview.data} moreInfo={<OutputStockHistory storageLocationId={storageLocationId} facilityId={facilityId} />} renderBlocker={blocker => blocker.entity === "binMovement" ? <OutputStockHistory key={blocker.id} storageLocationId={storageLocationId} facilityId={facilityId} movementId={blocker.id} triggerLabel={`Open ${blocker.code}`} /> : undefined} />}
      </FormSection>
      <FormSection title="Reason" fields={["reason"]}>
        <FormField id="stock-reason" label="Reason" required error={errors.reason?.message}>
          <FormTextarea disabled={mutation.isPending} id="stock-reason" {...register("reason")} />
        </FormField>
      </FormSection>
    </FormSpine>
    <FormActions control={control} onCancel={onCancel} isSubmitting={mutation.isPending} errorMessage={serverError} submitDisabled={!input || !preview.data || preview.isFetching || !!preview.data.blockingMessage} submitLabel={original ? "Save correction" : kind === "count" ? "Reconcile stock" : "Record loss"} />
  </form>;
}
