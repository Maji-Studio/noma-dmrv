/**
 * The Production Run form's credit batch line (#1164): which credit batch the
 * run joins, is expected to join, or already belongs to, worked out on the
 * server from the unsaved form values with the save path's own rule (#1099).
 *
 * Inputs settle for a moment before a check runs, and the line says
 * "Checking" whenever the last answer is not for the current inputs, so an
 * earlier match never shows as current.
 */
"use client";

import { useWatch, type Control } from "react-hook-form";
import { CreditBatchLine } from "@/components/credit-batches/credit-batch-line";
import { CREDIT_BATCH_PREVIEW_DEBOUNCE_MS } from "@/components/credit-batches/credit-batch-line-copy";
import { useDebounce } from "@/hooks/use-debounce";
import { useProductionRunCreditBatchPreview } from "@/hooks/use-production-run-credit-batch-preview";
import { resolveRunWindow } from "@/lib/production-runs/run-window";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import type { ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import {
  describeCreditBatchPreview,
  type ProductionRunCreditBatchPreviewView,
} from "./production-run-credit-batch-preview-copy";

/** The form values the line reads; the form's own values type is wider. */
export interface CreditBatchPreviewFormValues {
  status: ProductionRunStatus;
  startDate: unknown;
  startTime: unknown;
  endDate: unknown;
  endTime: unknown;
  /** Draw rows as the form holds them; blank rows are skipped. */
  feedstockDraws: readonly ({ storageLocationId?: string | null } | undefined)[];
}

export interface CreditBatchPreviewContext {
  facilityId: string | null | undefined;
  productionRunId: string | undefined;
  /** The selected facility's zone, as the save path resolves the times. */
  timeZone: string;
  /** Reopening a finished run: the save clears its end time, so the preview ignores it. */
  clearEndTime: boolean;
}

const WATCHED_FIELDS = ["status", "startDate", "startTime", "endDate", "endTime", "feedstockDraws"] as const;

/**
 * The preview request for the form values. Like the save, an end time
 * without an end date reads on the start date.
 */
export function buildCreditBatchPreviewInput(
  values: CreditBatchPreviewFormValues,
  context: CreditBatchPreviewContext,
): ProductionRunCreditBatchPreviewInput {
  const { start, end } = resolveRunWindow(values, context.timeZone);
  const binIds = (values.feedstockDraws ?? [])
    .map((draw) => draw?.storageLocationId)
    .filter((id): id is string => !!id);
  return {
    facilityId: context.facilityId || null,
    productionRunId: context.productionRunId ?? null,
    status: values.status,
    startTime: start?.toISOString() ?? null,
    endTime: context.clearEndTime ? null : (end?.toISOString() ?? null),
    feedstockStorageLocationIds: [...new Set(binIds)].sort(),
  };
}

export function ProductionRunCreditBatchPreview<TFieldValues extends CreditBatchPreviewFormValues, TTransformed>({
  control,
  ...context
}: CreditBatchPreviewContext & { control: Control<TFieldValues, unknown, TTransformed> }) {
  // Narrowed to the fields read here; the form's control carries more.
  const previewControl = control as unknown as Control<CreditBatchPreviewFormValues>;
  const [status, startDate, startTime, endDate, endTime, feedstockDraws] = useWatch({
    control: previewControl,
    name: WATCHED_FIELDS,
  });
  const values: CreditBatchPreviewFormValues = { status, startDate, startTime, endDate, endTime, feedstockDraws };
  // A string key: equal inputs stay equal across renders, so the debounce
  // settles, and the query key compares by value.
  const requestKey = JSON.stringify(buildCreditBatchPreviewInput(values, context));
  const settledKey = useDebounce(requestKey, CREDIT_BATCH_PREVIEW_DEBOUNCE_MS);
  const query = useProductionRunCreditBatchPreview(
    JSON.parse(settledKey) as ProductionRunCreditBatchPreviewInput,
  );

  // Only a settled answer for exactly the current inputs is shown: while they
  // settle or any check runs (a refetch on focus or after a save elsewhere
  // included), the line says so instead of keeping the last match.
  const view: ProductionRunCreditBatchPreviewView =
    settledKey !== requestKey || query.isFetching
      ? { state: "pending" }
      : query.isError
        ? { state: "error" }
        : query.data ?? { state: "pending" };
  const copy = describeCreditBatchPreview(view);

  return (
    <CreditBatchLine
      copy={copy}
      facilityId={context.facilityId}
      retrying={query.isFetching}
      onRetry={() => void query.refetch()}
    />
  );
}
