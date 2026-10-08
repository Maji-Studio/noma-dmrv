"use client";

import { FormActions, FormField, FormSection, FormSpine, FormTextarea, ResolvedErrorRevalidator } from "@/components/forms";
import { EventTimeInput } from "@/components/forms/event-time-input";
import { MoistureField, WetMassField } from "@/components/forms/mass-moisture-fields";
import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { usePostOutputStock } from "@/hooks/use-output-stock";
import { useFacilityClock } from "@/hooks/use-facility-context";
import { useOutputDrawDraft } from "@/hooks/use-output-draw-draft";
import { useSubBinDraw } from "@/hooks/use-sub-bin-draw";
import { formatFacilityDateTime } from "@/lib/format-utils";
import { toNumberOrNull } from "@/schemas/helpers";
import { outputStockPostSchema, outputStockPreviewSchema } from "@/schemas/output-stock";
import type { OutputStockHistoryEntry, OutputStockPreviewInput } from "@/types/output-stock";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { OutputStockHistory } from "./output-stock-history";
import { OutputStockPreview, type StockEntryKind } from "./output-stock-preview";
import { formatWetAtMoisture, InlineMassChange, StockRows } from "./stock-figures";
import { SubBinDrawField } from "./sub-bin-draw-field";
import { Notice } from "@/components/ui/notice";

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
  const [attempted, setAttempted] = useState(false);
  const mutation = usePostOutputStock();
  const clock = useFacilityClock(facilityId);
  const { control, register, handleSubmit, setValue, trigger, formState: { errors } } = useForm({
    resolver: zodResolver(outputStockPostSchema),
    mode: "onTouched",
    defaultValues: {
      storageLocationId, facilityId, kind, correctsMovementId: original?.id,
      expectedProductVersions: {}, basisFingerprint: "pending-preview", idempotencyKey,
      occurredAt: original?.occurredAt ?? new Date().toISOString(),
      wetMassKg: original?.wetMassKg ?? undefined,
      // A correction starts from the saved reading. A split draw replays its
      // saved sub-bin readings on the server, so it has no single one here.
      moisturePercent: original && !original.sources?.length ? original.moisturePercent : null,
      reason: "",
    },
  });
  const values = useWatch({ control });
  const wetMassKg = values.wetMassKg;
  const splitOriginal = Boolean(original?.sources?.length);
  // A split bin takes one reading per sub-bin the loss reaches. A count covers
  // the whole bin, and a correction of an entry saved at one moisture keeps it.
  const draw = useSubBinDraw({
    bin: kind !== "count" && (!original || splitOriginal) ? { storageLocationId, facilityId } : null,
    occurredAt: values.occurredAt, wetKg: wetMassKg,
    correction: original ? { movementId: original.id, kind, sources: original.sources } : undefined,
  });
  const candidate = outputStockPreviewSchema.safeParse(draw.active
    ? { ...values, moisturePercent: null, sources: draw.sources ?? undefined }
    : { ...values, sources: undefined, moisturePercent: kind === "count" && wetMassKg === 0 ? null : values.moisturePercent });
  // Until every reached sub-bin is read there is nothing to preview. A split
  // correction waits for its rows: without them the server would quietly
  // replay the saved readings at the new weight. A correction's estimate must
  // leave out the entry it replaces, which only its own preview does, so it
  // skips the bin lookup but keeps the facility clock.
  const { preview, input, estimate, gate, beginSubmit } = useOutputDrawDraft({
    draw, singleMoistureReady: !splitOriginal, moisturePercent: candidate.success ? candidate.data.moisturePercent : null,
    entry: candidate.success ? candidate.data : null,
    estimateFor: { storageLocationId: original ? null : storageLocationId, facilityId, occurredAt: values.occurredAt },
    writeReadings: (sources) => setValue("sources", sources),
  });
  const { canSave, submitDisabled, basisFingerprint } = gate();
  // Names the entry in the preview's caption. A replaced loss or delivery is
  // still wet mass removed from the bin; a replaced count is still a count.
  const entryKind: StockEntryKind = kind === "count" ? "count" : original ? "correction" : "loss";
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
      {original && <FormSection title="Original entry">
        <p className="body-small">{outputStockEventLabel(original.kind)} on {formatFacilityDateTime(original.occurredAt, clock.timeZone)}.</p>
        {/* One aligned row set: the entry's own figures, nothing hidden behind
            a control and nothing restated as a sentence. */}
        <StockRows label="Original entry figures" rows={[
          ...(original.wetMassKg === null ? [] : [{ label: "Wet", value: formatWetAtMoisture(original.wetMassKg, original.moisturePercent) }]),
          { label: "Dry biochar", value: <InlineMassChange beforeKg={original.beforeDryKg} afterKg={original.afterDryKg} /> },
        ]} />
      </FormSection>}
      <FormSection title={original ? "Proposed replacement" : kind === "count" ? "Reconcile stock" : "Record loss"} fields={["occurredAt", "wetMassKg", "moisturePercent"]}>
        <FormField id="occurredAt" label="Date and time" required error={errors.occurredAt?.message} cue={clock.hint}>
          <EventTimeInput control={control} name="occurredAt" id="occurredAt" timeZone={clock.timeZone} disabled={mutation.isPending} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-16 gap-y-20">
          <WetMassField id="stock-wet" label={kind === "count" ? "Counted wet mass (kg)" : "Wet mass removed (kg)"} required disabled={mutation.isPending} error={errors.wetMassKg?.message} registration={register("wetMassKg", { setValueAs: toNumberOrNull })} />
          {draw.usesSingleMoisture && !splitOriginal && <MoistureField id="stock-moisture" required={!(kind === "count" && wetMassKg === 0)} disabled={mutation.isPending} error={errors.moisturePercent?.message} helperText="Enter less than 100%. A zero count does not need moisture." estimate={estimate} reading={values.moisturePercent} registration={register("moisturePercent", { setValueAs: toNumberOrNull })} />}
        </div>
        {draw.active && <SubBinDrawField draw={draw} timeZone={clock.timeZone} idPrefix="stock" disabled={mutation.isPending} showErrors={attempted} />}
        {draw.query.error && <Notice tone="error">{draw.query.error.message}</Notice>}
        {preview.isFetching && <p role="status" className="body-caption text-[var(--color-text-secondary)]">Refreshing the stock preview</p>}
        {preview.error && <Notice tone="error">{preview.error.message}</Notice>}
        {preview.data && <OutputStockPreview variant="movement" preview={preview.data} entry={{ kind: entryKind, wetMassKg: input?.wetMassKg }} moreInfo={<OutputStockHistory compact triggerLabel="Stock history" storageLocationId={storageLocationId} facilityId={facilityId} />} renderBlocker={blocker => blocker.entity === "binMovement" ? <OutputStockHistory key={blocker.id} storageLocationId={storageLocationId} facilityId={facilityId} movementId={blocker.id} triggerLabel={`Open ${blocker.code}`} /> : undefined} />}
      </FormSection>
      <FormSection title="Reason" fields={["reason"]}>
        <FormField id="stock-reason" label="Reason" required error={errors.reason?.message}>
          <FormTextarea disabled={mutation.isPending} id="stock-reason" {...register("reason")} />
        </FormField>
      </FormSection>
    </FormSpine>
    <FormActions control={control} onCancel={onCancel} isSubmitting={mutation.isPending} errorMessage={serverError} submitDisabled={submitDisabled} submitLabel={original ? "Save correction" : kind === "count" ? "Reconcile stock" : "Record loss"} />
  </form>;
}
