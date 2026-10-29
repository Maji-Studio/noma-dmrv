import Link from "next/link";
import { MissingRunLinks } from "@/components/credit-batches/credit-batch-missing-runs-notice";
import { Notice } from "@/components/ui/notice";
import {
  missingRunsCountedSentence,
  missingRunsMemberNamedSentence,
  missingRunsMemberSentence,
  refusedRunsSentence,
  sameDayEntrySentence,
} from "@/lib/credit-batches/open-items";
import { recordHref } from "@/lib/record-links";
import type { RemovalPreflightSummary } from "@/fn/certification/overview";
import { NOTICE_ACTION_LINK_CLASS } from "./removal-resubmit-notice";

/**
 * Before an unsent Removal goes out: a member credit batch is missing completed
 * runs that fit it, so their emissions would not be counted. One notice per
 * batch; the batch's Edit is where Add run lives.
 */
export function RemovalMissingRunsNotice({
  batches,
  facilityId,
  canManage,
}: {
  batches: RemovalPreflightSummary["missingProductionRuns"];
  facilityId: string;
  /** Admin: others are told who can add the run. */
  canManage: boolean;
}) {
  return (
    <>
      {batches.map((batch) => {
        const one = batch.runs.length === 1;
        const refused = batch.runs.filter((run) => !run.canAdd).map((run) => run.code);
        const addable = batch.runs.filter((run) => run.canAdd);
        const sameDayCount = addable.filter((run) => run.sameDayEntry).length;
        const batchHref = recordHref("creditBatch", batch.creditBatchId, { facilityId });
        const emissionsHref = recordHref("creditBatch", batch.creditBatchId, { facilityId, tab: "emissions" });
        return (
          <Notice
            key={batch.creditBatchId}
            tone="warning"
            data-removal-missing-runs={batch.creditBatchId}
            title={`${one ? "1 completed run is" : `${batch.runs.length} completed runs are`} not in ${batch.creditBatchCode} yet`}
            action={
              <span className="flex flex-wrap gap-x-16">
                {addable.length > 0 && (
                  <Link href={batchHref} className={NOTICE_ACTION_LINK_CLASS}>
                    Open credit batch
                  </Link>
                )}
                {refused.length > 0 && (
                  <Link href={emissionsHref} className={NOTICE_ACTION_LINK_CLASS}>
                    Open Emissions
                  </Link>
                )}
              </span>
            }
          >
            <MissingRunLinks runs={batch.runs} facilityId={facilityId} />
            {`. ${missingRunsCountedSentence(batch.runs.length)}`}
            {refused.length > 0 && ` ${refusedRunsSentence(refused, addable.length === 0)}`}
            {!canManage && addable.length > 0 && ` ${refused.length === 0
              ? missingRunsMemberSentence(addable.length)
              : missingRunsMemberNamedSentence(addable.map((run) => run.code))}`}
            {canManage && sameDayCount > 0 && ` ${sameDayEntrySentence(sameDayCount)}`}
          </Notice>
        );
      })}
    </>
  );
}
