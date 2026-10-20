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

import Link from "next/link";
import { Fragment } from "react";
import { useWatch, type Control } from "react-hook-form";
import { CertificateIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button";
import { FormFooterPreview } from "@/components/forms/form-footer-preview";
import { useDebounce } from "@/hooks/use-debounce";
import { useProductionRunCreditBatchPreview } from "@/hooks/use-production-run-credit-batch-preview";
import { combineDateAndTime, formatLocalDate } from "@/lib/date-utils";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import type { ProductionRunStatus } from "@/lib/production-runs/lifecycle";
import type { ProductionRunCreditBatchPreviewInput } from "@/schemas/production-run-credit-batch-preview";
import {
  CREDIT_BATCH_INFO_LABEL,
  describeCreditBatchPreview,
  type ProductionRunCreditBatchPreviewView,
} from "./production-run-credit-batch-preview-copy";

/** How long the inputs rest before the server is asked again. */
export const CREDIT_BATCH_PREVIEW_DEBOUNCE_MS = 350;

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

function dayString(value: unknown): string | null {
  if (typeof value === "string") return value || null;
  return value instanceof Date ? formatLocalDate(value) : null;
}

/** The instant a facility wall-clock date and time name, or null while unfinished or invalid. */
function instant(date: string | null, time: unknown, timeZone: string): string | null {
  if (!date || typeof time !== "string" || !time) return null;
  try {
    const value = combineDateAndTime(date, time, timeZone);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  } catch {
    return null;
  }
}

/**
 * The preview request for the form values. Like the save, an end time
 * without an end date reads on the start date.
 */
export function buildCreditBatchPreviewInput(
  values: CreditBatchPreviewFormValues,
  context: CreditBatchPreviewContext,
): ProductionRunCreditBatchPreviewInput {
  const startDate = dayString(values.startDate);
  const endDate = dayString(values.endDate) ?? startDate;
  const binIds = (values.feedstockDraws ?? [])
    .map((draw) => draw?.storageLocationId)
    .filter((id): id is string => !!id);
  return {
    facilityId: context.facilityId || null,
    productionRunId: context.productionRunId ?? null,
    status: values.status,
    startTime: instant(startDate, values.startTime, context.timeZone),
    endTime: context.clearEndTime ? null : instant(endDate, values.endTime, context.timeZone),
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
    <FormFooterPreview
      icon={CertificateIcon}
      tone={copy.tone}
      busy={copy.busy}
      info={copy.info ? { label: CREDIT_BATCH_INFO_LABEL, content: copy.info } : null}
      action={copy.retry ? (
        <Button type="button" variant="default" size="small" busy={query.isFetching} onClick={() => void query.refetch()}>
          Retry
        </Button>
      ) : undefined}
    >
      {copy.lead}
      {copy.batches.map((batch, index) => (
        <Fragment key={batch.id}>
          {index > 0 && ", "}
          {/* A new tab, so the unsaved run stays open. */}
          <Link
            href={creditBatchDeepLinkHref(batch.id, context.facilityId ?? undefined)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-[var(--clr-dark-purple)] underline underline-offset-2"
          >
            {batch.code}
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </Fragment>
      ))}
      {copy.tail}
    </FormFooterPreview>
  );
}
