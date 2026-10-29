import Link from "next/link";
import { MissingRunLinks } from "@/components/credit-batches/credit-batch-missing-runs-notice";
import { Notice } from "@/components/ui/notice";
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
        return (
          <Notice
            key={batch.creditBatchId}
            tone="warning"
            data-removal-missing-runs={batch.creditBatchId}
            title={`${one ? "1 completed run is" : `${batch.runs.length} completed runs are`} not in ${batch.creditBatchCode} yet`}
            action={
              <Link href={recordHref("creditBatch", batch.creditBatchId, { facilityId })} className={NOTICE_ACTION_LINK_CLASS}>
                Open credit batch
              </Link>
            }
          >
            <MissingRunLinks runs={batch.runs} facilityId={facilityId} />
            {`. ${one ? "Its" : "Their"} emissions are not counted. ${canManage ? `Open the credit batch and add ${one ? "it" : "them"} in Edit.` : `An admin can add ${one ? "it" : "them"} in Edit.`}`}
          </Notice>
        );
      })}
    </>
  );
}
