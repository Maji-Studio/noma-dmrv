import type { ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { CENTRED_HIT_AREA, INLINE_HIT_AREA } from "@/components/ui/touch-target";
import {
  LATE_PRODUCTION_RUN_ITEM_PREFIX,
  MISSING_PRODUCTION_RUN_ITEM_PREFIX,
  missingRunsAdminSentence,
  missingRunsCountedSentence,
  missingRunsMemberSentence,
  sameDayEntrySentence,
} from "@/lib/credit-batches/open-items";
import { recordHref } from "@/lib/record-links";
import { cn } from "@/lib/utils";

export interface MissingRunRef {
  id: string;
  code: string;
  /** A later Emissions entry dated the run's day may already record its emissions. */
  sameDayEntry?: boolean;
}

/** The runs the batch's missing-run Check names, from the batch's to-dos. */
export function missingRunsFromTodos(
  check: readonly { productionRun?: MissingRunRef; id: string; sameDayEntry?: boolean }[] | undefined,
): MissingRunRef[] {
  return (check ?? []).flatMap((item) =>
    item.id.startsWith(MISSING_PRODUCTION_RUN_ITEM_PREFIX) && item.productionRun
      ? [item.sameDayEntry ? { ...item.productionRun, sameDayEntry: true } : item.productionRun]
      : [],
  );
}

/** Run codes, each linked to its run in a new tab, joined by commas. */
export function MissingRunLinks({ runs, facilityId }: { runs: readonly MissingRunRef[]; facilityId: string }) {
  return (
    <>
      {runs.map((run, index): ReactNode => (
        <span key={run.id}>
          {index > 0 && ", "}
          <Link
            href={recordHref("productionRun", run.id, { facilityId })}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(INLINE_HIT_AREA, RECORD_CODE_LINK)}
          >
            {run.code}
          </Link>
        </span>
      ))}
    </>
  );
}

interface CreditBatchMissingRunsNoticeProps {
  runs: readonly MissingRunRef[];
  facilityId: string;
  /** Admin: others are told who can add the run. */
  canManage: boolean;
  /** Opens Edit, where Add run lives; omitted when the viewer cannot edit. */
  onEdit?: () => void;
}

/**
 * View mode of the batch: completed runs that fit it but are not in it, so
 * their emissions are not counted. Only a batch held by an unsent Removal
 * has them.
 */
export function CreditBatchMissingRunsNotice({ runs, facilityId, canManage, onEdit }: CreditBatchMissingRunsNoticeProps) {
  if (runs.length === 0) return null;
  const one = runs.length === 1;
  const sameDay = runs.some((run) => run.sameDayEntry);
  // With the Edit button the action is already there; without it say who adds the run.
  const nextStep = canManage
    ? (onEdit ? null : missingRunsAdminSentence(runs.length))
    : missingRunsMemberSentence(runs.length);
  return (
    <Notice
      tone="warning"
      data-testid="credit-batch-missing-runs"
      title={one ? "1 completed run is not in this credit batch yet" : `${runs.length} completed runs are not in this credit batch yet`}
      action={onEdit ? (
        <Button type="button" variant="weak" size="small" className={CENTRED_HIT_AREA} onClick={onEdit}>
          Add in Edit
        </Button>
      ) : undefined}
    >
      <MissingRunLinks runs={runs} facilityId={facilityId} />
      {`. ${missingRunsCountedSentence(runs.length)}`}
      {nextStep && ` ${nextStep}`}
      {canManage && sameDay && ` ${sameDayEntrySentence(runs.length)}`}
    </Notice>
  );
}

/** A Sent batch's late-run Check, as the sheet reads it: the Check's own words. */
export interface LateRunRef extends MissingRunRef {
  title: string;
  titleAfterCode?: string;
  detail?: string;
}

export function lateRunsFromTodos(
  check: readonly { id: string; productionRun?: MissingRunRef; title: string; titleAfterCode?: string; detail?: string }[] | undefined,
): LateRunRef[] {
  return (check ?? []).flatMap((item) =>
    item.id.startsWith(LATE_PRODUCTION_RUN_ITEM_PREFIX) && item.productionRun
      ? [{ ...item.productionRun, title: item.title, titleAfterCode: item.titleAfterCode, detail: item.detail }]
      : [],
  );
}

/**
 * View mode of a Sent batch: a completed run that fits it was recorded after
 * its Removal was sent. Sent stays locked, so the next step is the Emissions
 * tab (open to everyone, as the Check's own target is), not Edit. One notice
 * per run, because each Check dates its own entry.
 */
export function CreditBatchLateRunsNotice({
  runs,
  creditBatchId,
  facilityId,
}: {
  runs: readonly LateRunRef[];
  creditBatchId: string;
  facilityId: string;
}) {
  return (
    <>
      {runs.map((run) => {
        const rest = run.titleAfterCode ?? null;
        return (
          <Notice
            key={run.id}
            tone="warning"
            data-testid="credit-batch-late-run"
            title={rest === null ? run.title : (
              <>
                <MissingRunLinks runs={[run]} facilityId={facilityId} />
                {`${rest}.`}
              </>
            )}
            action={
              <Link
                href={recordHref("creditBatch", creditBatchId, { facilityId, tab: "emissions" })}
                className={cn(buttonVariants({ variant: "weak", size: "small" }), CENTRED_HIT_AREA)}
              >
                Open Emissions
              </Link>
            }
          >
            {run.detail}
          </Notice>
        );
      })}
    </>
  );
}
