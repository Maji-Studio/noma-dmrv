import type { ReactNode } from "react";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { CENTRED_HIT_AREA, INLINE_HIT_AREA } from "@/components/ui/touch-target";
import {
  LATE_PRODUCTION_RUN_ITEM_PREFIX,
  MISSING_PRODUCTION_RUN_ITEM_PREFIX,
  MISSING_PRODUCTION_RUN_TITLE,
  READ_ONLY_MISSING_PRODUCTION_RUN_TITLE,
  missingRunsAdminSentence,
  missingRunsCountedSentence,
  missingRunsMemberSentence,
  openItemText,
  sameDayEntryWarning,
} from "@/lib/credit-batches/open-items";
import { recordHref } from "@/lib/record-links";
import { cn } from "@/lib/utils";

export interface MissingRunRef {
  id: string;
  code: string;
  /** A later Emissions entry dated the run's day may already record its emissions. */
  sameDayEntryDate?: string;
}

/** The runs the batch's missing-run Check names, from the batch's to-dos. */
export function missingRunsFromTodos(
  check: readonly { productionRun?: MissingRunRef; id: string; sameDayEntryDate?: string }[] | undefined,
): MissingRunRef[] {
  return (check ?? []).flatMap((item) =>
    item.id.startsWith(MISSING_PRODUCTION_RUN_ITEM_PREFIX) && item.productionRun
      ? [item.sameDayEntryDate ? { ...item.productionRun, sameDayEntryDate: item.sameDayEntryDate } : item.productionRun]
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
  /** A read-only batch states the fact alone: no next step, no button. */
  readOnly?: boolean;
}

/**
 * View mode of the batch: completed runs that fit it but are not in it, so
 * their emissions are not counted. Only a batch held by an unsent Removal
 * has them.
 */
export function CreditBatchMissingRunsNotice({ runs, facilityId, canManage, onEdit, readOnly = false }: CreditBatchMissingRunsNoticeProps) {
  if (runs.length === 0) return null;
  const one = runs.length === 1;
  const sameDay = sameDayEntryWarning(runs);
  const titleEnd = readOnly ? READ_ONLY_MISSING_PRODUCTION_RUN_TITLE : MISSING_PRODUCTION_RUN_TITLE;
  // With the Edit button the action is already there; without it say who adds the run.
  const nextStep = readOnly ? null : canManage
    ? (onEdit ? null : missingRunsAdminSentence(runs.length))
    : missingRunsMemberSentence(runs.length);
  return (
    <Notice
      tone="warning"
      data-testid="credit-batch-missing-runs"
      title={one ? `1 completed run${titleEnd}` : `${runs.length} completed runs${titleEnd.replace(" is ", " are ")}`}
      action={onEdit && !readOnly ? (
        <Button type="button" variant="weak" size="small" className={CENTRED_HIT_AREA} onClick={onEdit}>
          Add in Edit
        </Button>
      ) : undefined}
    >
      <MissingRunLinks runs={runs} facilityId={facilityId} />
      {`. ${missingRunsCountedSentence(runs.length)}`}
      {nextStep && ` ${nextStep}`}
      {!readOnly && canManage && sameDay && ` ${sameDay}`}
    </Notice>
  );
}

/** A late-run Check (Sent batch, or a held run Add run refuses), as the sheet reads it: the Check's own words. */
export interface LateRunRef extends MissingRunRef {
  title: string;
  titleAfterCode?: string;
  detail?: string;
  instruction?: string;
}

export function lateRunsFromTodos(
  check: readonly { id: string; productionRun?: MissingRunRef; title: string; titleAfterCode?: string; detail?: string; instruction?: string }[] | undefined,
): LateRunRef[] {
  return (check ?? []).flatMap((item) =>
    item.id.startsWith(LATE_PRODUCTION_RUN_ITEM_PREFIX) && item.productionRun
      ? [{ ...item.productionRun, title: item.title, titleAfterCode: item.titleAfterCode, detail: item.detail, instruction: item.instruction }]
      : [],
  );
}

/**
 * View mode of a late run: one recorded after its Removal was sent, or one a
 * held batch cannot take because its biochar is in another Removal's
 * Application. Neither can be added in Edit, so the next step is the Emissions
 * tab (open to everyone, as the Check's own target is). One notice per run,
 * because each Check dates its own entry.
 */
export function CreditBatchLateRunsNotice({
  runs,
  creditBatchId,
  facilityId,
  readOnly = false,
}: {
  runs: readonly LateRunRef[];
  creditBatchId: string;
  facilityId: string;
  /** A read-only batch states the fact alone: no record instruction, no Open Emissions button. */
  readOnly?: boolean;
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
            action={readOnly ? undefined : (
              <Link
                href={recordHref("creditBatch", creditBatchId, { facilityId, tab: "emissions" })}
                className={cn(buttonVariants({ variant: "weak", size: "small" }), CENTRED_HIT_AREA)}
              >
                Open Emissions
              </Link>
            )}
          >
            {readOnly ? run.detail : openItemText(run)}
          </Notice>
        );
      })}
    </>
  );
}
