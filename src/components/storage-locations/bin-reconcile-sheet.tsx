"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import { FormField, FormInput, FormTextarea, ServerError } from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { useToast } from "@/components/ui/toast";
import { numericValue } from "@/lib/form-utils";
import { formatMass } from "@/lib/format-utils";
import {
  RecordLossFieldError,
  useRecordLoss,
  useRecordStockTake,
} from "@/hooks/use-bin-movements";
import {
  BIN_MOVEMENT_LANE_LABELS,
  laneForStorageType,
  recordLossFormSchema,
  stockTakeFormSchema,
  type RecordLossFormData,
  type StockTakeFormData,
} from "@/schemas/bin-movements";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { binCurrentMassKg } from "./bin-display";

type ReconcileMode = "stock-take" | "loss";

interface BinReconcileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storageLocation: StorageLocationWithFacility | null;
  /** Called after a movement is recorded (parent closes + toasts already fired). */
  onRecorded?: () => void;
}

const MODE_OPTIONS: { value: ReconcileMode; label: string }[] = [
  { value: "stock-take", label: "Stock-take" },
  { value: "loss", label: "Record loss" },
];

function ModeToggle({
  value,
  onChange,
}: {
  value: ReconcileMode;
  onChange: (value: ReconcileMode) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Reconciliation type"
      className="flex border-[1.5px] border-[var(--clr-dark-purple-20)]"
    >
      {MODE_OPTIONS.map((option, index) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={[
              "label-micro h-40 flex-1 px-16 transition-colors",
              index < MODE_OPTIONS.length - 1
                ? "border-r-[1.5px] border-[var(--clr-dark-purple-20)]"
                : "",
              isActive
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Read-only chip naming the single material lane this bin reconciles. */
function LaneContext({
  storageLocation,
}: {
  storageLocation: StorageLocationWithFacility;
}) {
  const lane = laneForStorageType(storageLocation.type);
  return (
    <div className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-12 py-10">
      <span className="body-caption text-[var(--color-text-tertiary)]">Lane</span>
      <span className="body-small font-medium text-[var(--color-text-primary)]">
        {BIN_MOVEMENT_LANE_LABELS[lane]}
      </span>
    </div>
  );
}

function StockTakeForm({
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
  const recordStockTake = useRecordStockTake();

  const lane = laneForStorageType(storageLocation.type);
  const derivedMassKg = binCurrentMassKg(storageLocation);
  const moisturePercent =
    lane === "feedstock"
      ? storageLocation.feedstockInventory.estimatedMoisturePercent
      : null;
  const useWet = lane === "feedstock" && moisturePercent != null;
  const moistureRatio = useWet ? (moisturePercent as number) / 100 : null;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(stockTakeFormSchema),
    defaultValues: { reason: "" },
  });

  const countedInput = watch("counted");
  const countedNum =
    typeof countedInput === "number" && !Number.isNaN(countedInput)
      ? countedInput
      : null;
  const countedDryKg =
    countedNum == null
      ? null
      : useWet && moistureRatio != null
        ? countedNum * (1 - moistureRatio)
        : countedNum;
  const deltaKg = countedDryKg != null ? countedDryKg - derivedMassKg : null;

  const countedLabel = useWet
    ? "Counted stock (wet kg)"
    : lane === "feedstock"
      ? "Counted stock (dry kg)"
      : "Counted stock (kg)";

  const onSubmit = handleSubmit(async (raw) => {
    setServerError(null);
    const values = raw as StockTakeFormData;
    const counted = values.counted;
    const isWet = useWet && moistureRatio != null;
    try {
      await recordStockTake.mutateAsync({
        storageLocationId: storageLocation.id,
        lane,
        reason: values.reason,
        countedMassKg: isWet ? counted * (1 - moistureRatio) : counted,
        countedWetMassKg: isWet ? counted : null,
        moistureRatioUsed: isWet ? moistureRatio : null,
      });
      toast.success("Stock-take recorded");
      onRecorded?.();
    } catch (error) {
      setServerError(
        error instanceof Error ? error.message : "Failed to record stock-take"
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col space-y-20">
      {serverError && <ServerError message={serverError} />}

      <div className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] px-12 py-10">
        <span className="body-caption text-[var(--color-text-tertiary)]">
          Current derived stock
        </span>
        <span className="body-small font-medium text-[var(--color-text-primary)]">
          {formatMass(derivedMassKg)}
        </span>
      </div>

      <FormField
        id="counted"
        label={countedLabel}
        error={errors.counted?.message}
        required
        helperText={
          useWet
            ? "Enter the physically weighed wet mass; it is converted to dry below."
            : undefined
        }
      >
        <FormInput
          id="counted"
          type="number"
          step="any"
          min="0"
          placeholder="e.g., 620"
          disabled={recordStockTake.isPending}
          error={!!errors.counted}
          {...register("counted", { setValueAs: numericValue })}
        />
      </FormField>

      {useWet && countedNum != null && countedDryKg != null && (
        <p className="body-caption text-[var(--color-text-secondary)]">
          {formatMass(countedNum)} wet ≈ {formatMass(countedDryKg)} dry at ~
          {Math.round(moisturePercent as number)}% moisture
        </p>
      )}

      {deltaKg != null && (
        <div className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-12 py-10">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Adjustment to record
          </span>
          <span
            className={`body-small font-mono font-medium ${
              deltaKg > 0
                ? "text-[var(--st-ok)]"
                : deltaKg < 0
                  ? "text-[var(--color-signal-red)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {deltaKg > 0 ? "+" : deltaKg < 0 ? "−" : ""}
            {formatMass(Math.abs(deltaKg))}
          </span>
        </div>
      )}

      <FormField
        id="stock-take-reason"
        label="Reason"
        error={errors.reason?.message}
        required
        helperText="Why the count differs — e.g. settling, scale recalibration, miscount."
      >
        <FormTextarea
          id="stock-take-reason"
          rows={3}
          placeholder="Document why the physical count differs from the system"
          disabled={recordStockTake.isPending}
          error={!!errors.reason}
          {...register("reason")}
        />
      </FormField>

      <FormActions
        onCancel={onCancel}
        isSubmitting={recordStockTake.isPending}
        submitLabel="Record stock-take"
      />
    </form>
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
  const recordLoss = useRecordLoss();
  const lane = laneForStorageType(storageLocation.type);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(recordLossFormSchema),
    defaultValues: { reason: "" },
  });

  const onSubmit = handleSubmit(async (raw) => {
    setServerError(null);
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
        setError(error.field, { type: "server", message: error.message });
        return;
      }
      setServerError(
        error instanceof Error ? error.message : "Failed to record loss"
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col space-y-20">
      {serverError && <ServerError message={serverError} />}

      <FormField
        id="loss-amount"
        label="Amount lost (kg)"
        error={errors.lossMassKg?.message}
        required
        helperText="The mass removed from the bin — spoilage, spillage, or write-off."
      >
        <FormInput
          id="loss-amount"
          type="number"
          step="any"
          min="0"
          placeholder="e.g., 50"
          disabled={recordLoss.isPending}
          error={!!errors.lossMassKg}
          {...register("lossMassKg", { setValueAs: numericValue })}
        />
      </FormField>

      <FormField
        id="loss-reason"
        label="Reason"
        error={errors.reason?.message}
        required
        helperText="What happened — e.g. spoiled batch, spilled during transfer, failed run."
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
  const [mode, setMode] = useState<ReconcileMode>("stock-take");

  // Reset to the stock-take default whenever a (different) bin's sheet opens —
  // the parent nulls `storageLocation` on close, so reopening always resets.
  // This is the React "adjust state during render" pattern (no useEffect).
  const [initialisedFor, setInitialisedFor] = useState<string | null>(null);
  const currentBinId = storageLocation?.id ?? null;
  if (currentBinId !== initialisedFor) {
    setInitialisedFor(currentBinId);
    if (mode !== "stock-take") setMode("stock-take");
  }

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
            toggle/lane/form live inside one flex column here. */}
        <SlideOverPanel.Body noPaddingBottom fillHeight>
          {storageLocation && (
            <div className="flex flex-1 flex-col gap-20">
              {/* Keyed so switching bins resets each sub-form's state. */}
              <ModeToggle value={mode} onChange={setMode} />
              <LaneContext storageLocation={storageLocation} />
              {mode === "stock-take" ? (
                <StockTakeForm
                  key={`stock-${storageLocation.id}`}
                  storageLocation={storageLocation}
                  onCancel={close}
                  onRecorded={handleRecorded}
                />
              ) : (
                <LossForm
                  key={`loss-${storageLocation.id}`}
                  storageLocation={storageLocation}
                  onCancel={close}
                  onRecorded={handleRecorded}
                />
              )}
            </div>
          )}
        </SlideOverPanel.Body>
      </SlideOverPanel.Content>
    </SlideOverPanel.Root>
  );
}
