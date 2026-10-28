import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { CENTRED_HIT_AREA, INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { productionRunDeepLinkHref } from "@/lib/certification/links";
import { MISSING_PRODUCTION_RUN_ITEM_PREFIX } from "@/lib/credit-batches/open-items";
import { cn } from "@/lib/utils";

export interface MissingRunRef {
  id: string;
  code: string;
}

/** The runs the batch's missing-run Check names, from the batch's to-dos. */
export function missingRunsFromTodos(
  check: readonly { productionRun?: MissingRunRef; id: string }[] | undefined,
): MissingRunRef[] {
  return (check ?? []).flatMap((item) =>
    item.id.startsWith(MISSING_PRODUCTION_RUN_ITEM_PREFIX) && item.productionRun ? [item.productionRun] : [],
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
            href={productionRunDeepLinkHref(run.id, facilityId)}
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
      {`. ${one ? "Its" : "Their"} emissions are not counted.${canManage ? "" : ` An admin can add ${one ? "it" : "them"} in Edit.`}`}
    </Notice>
  );
}
