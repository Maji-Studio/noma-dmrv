"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { SlideOverPanel } from "@/components/ui/slide-over-panel";
import {
  FormField,
  FormInput,
  FormTextarea,
  MoistureField,
  ResolvedErrorRevalidator,
} from "@/components/forms";
import { FormActions } from "@/components/forms/form-actions";
import { MoistureSplit } from "@/components/ui/moisture-split";
import { useToast } from "@/components/ui/toast";
import { formatMassKg } from "@/lib/format-utils";
import { formatMoisturePercent } from "@/lib/mass-moisture";
import { canonicalizeFeedstockStockTake } from "@/lib/calculations/bin-stock-take";
import {
  RecordLossFieldError,
  RecordStockTakeFieldError,
  useRecordLoss,
  useRecordStockTake,
} from "@/hooks/use-bin-movements";
import {
  laneForStorageType,
  recordLossFormSchema,
  stockTakeFormSchema,
  type RecordLossFormData,
  type StockTakeFormData,
} from "@/schemas/bin-movements";
import { toNumberOrNull } from "@/schemas/helpers";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { binCurrentMassKg } from "./bin-display";
import {
  binStockOverdrawMessage,
  isStockOverdraw,
} from "@/lib/stock-overdraw";

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

/**
 * Fixed kg throughout this sheet: the book figure, the counted mass and the
 * delta are the same arithmetic the movement history then prints in kg, so the
 * operator never confirms "1.2 t" and reads back "+1,200 kg".
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
  const isFeedstock = lane === "feedstock";

  const {
    register,
    handleSubmit,
    setError,
    control,
    trigger,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(stockTakeFormSchema),
    defaultValues: {
      lane,
      reason: "",
    },
  });

  const [countedInput, measuredMoistureInput] = useWatch({
    control,
    name: ["counted", "moisturePercent"],
  });
  const countedNum = previewNumber(countedInput);
  const measuredMoisturePercent = previewNumber(measuredMoistureInput);
  const canonicalStockTake =
    countedNum == null
      ? null
      : isFeedstock
        ? countedNum >= 0 &&
          measuredMoisturePercent != null &&
          measuredMoisturePercent >= 0 &&
          measuredMoisturePercent <= 100
          ? canonicalizeFeedstockStockTake(
              countedNum,
              measuredMoisturePercent / 100,
            )
          : null
        : null;
  const countedDryKg = isFeedstock
    ? canonicalStockTake?.countedMassKg ?? null
    : countedNum;
  const deltaKg = countedDryKg != null ? countedDryKg - derivedMassKg : null;

  const countedLabel = isFeedstock
    ? "Counted stock, wet (kg)"
    : "Counted stock (kg)";

  const onSubmit = handleSubmit(async (raw) => {
    setServerError(null);
    const values = raw as StockTakeFormData;
    const counted = values.counted;
    const enteredMoisturePercent = values.moisturePercent;
    const isWet = isFeedstock && enteredMoisturePercent != null;
    const submittedStockTake = isWet
      ? canonicalizeFeedstockStockTake(
          counted,
          enteredMoisturePercent / 100,
        )
      : null;
    try {
      await recordStockTake.mutateAsync({
        storageLocationId: storageLocation.id,
        lane,
        reason: values.reason,
        countedMassKg: submittedStockTake?.countedMassKg ?? counted,
        countedWetMassKg: submittedStockTake?.countedWetMassKg ?? null,
        moistureRatioUsed: submittedStockTake?.moistureRatioUsed ?? null,
      });
      toast.success("Stock-take recorded");
      onRecorded?.();
    } catch (error) {
      if (error instanceof RecordStockTakeFieldError) {
        setError(error.field, { type: "server", message: error.message });
        return;
      }
      setServerError(
        error instanceof Error ? error.message : "Failed to record stock-take"
      );
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-1 flex-col space-y-20">
      <ResolvedErrorRevalidator control={control} trigger={trigger} />
      <FormField
        id="counted"
        label={countedLabel}
        error={errors.counted?.message}
        required
      >
        <FormInput
          id="counted"
          type="number"
          step="any"
          min="0"
          placeholder="e.g., 620"
          disabled={recordStockTake.isPending}
          error={!!errors.counted}
          {...register("counted")}
        />
      </FormField>

      {isFeedstock && (
        <MoistureField
          id="moisture-percent"
          error={errors.moisturePercent?.message}
          required
          disabled={recordStockTake.isPending}
          placeholder="e.g. 18"
          helperText="Measured for this stock-take"
          registration={register("moisturePercent")}
        />
      )}

      {isFeedstock && (
        <div className="border-l-2 border-[var(--color-border-primary)] bg-[var(--color-background-medium)] px-16 py-12">
          <MoistureSplit
            wetMassKg={countedNum}
            moisturePercent={measuredMoisturePercent}
            note="Counted wet mass is converted to dry before comparison."
          />
        </div>
      )}

      {deltaKg != null && (
        <div className="flex items-center justify-between gap-8 border border-[var(--color-border-tertiary)] bg-[var(--color-background-light)] px-12 py-10">
          <span className="body-caption text-[var(--color-text-tertiary)]">
            Adjustment to record
          </span>
          <span
            className={`body-small font-mono font-medium ${
              deltaKg > 0
                ? "text-[var(--color-signal-red)]"
                : deltaKg < 0
                  ? "text-[var(--color-signal-red)]"
                  : "text-[var(--color-text-primary)]"
            }`}
          >
            {deltaKg > 0 ? "+" : deltaKg < 0 ? "−" : ""}
            {formatMassKg(Math.abs(deltaKg))}
          </span>
        </div>
      )}

      {deltaKg != null && deltaKg > 0 && (
        <p className="body-caption text-[var(--color-signal-red)]">
          This count is above the displayed stock. Submit to recheck it against
          the current inventory.
        </p>
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
        errorMessage={serverError ?? undefined}
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
      ? binStockOverdrawMessage(lane, availableKg, lossMassKg)
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
        error instanceof Error ? error.message : "Failed to record loss"
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
        helperText="The mass removed from the bin — spoilage, spillage, or write-off."
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
            toggle and form live inside one flex column here. */}
        <SlideOverPanel.Body noPaddingBottom fillHeight>
          {storageLocation && (
            <div className="flex flex-1 flex-col gap-20">
              {/* Keyed so switching bins resets each sub-form's state. */}
              <ModeToggle value={mode} onChange={setMode} />
              <CurrentStockContext storageLocation={storageLocation} />
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
