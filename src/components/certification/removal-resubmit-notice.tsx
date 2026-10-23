import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { buttonVariants } from "@/components/ui";
import { PHONE_TOUCH_TARGET } from "@/components/ui/touch-target";
import { cn } from "@/lib/utils";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { creditBatchDeepLinkHref } from "@/lib/credit-batch-links";
import { Notice } from "@/components/ui/notice";
import { RETURNED_BY_ISOMETRIC_LABEL } from "@/lib/certification/emission-entry-messages";
import type { RemovalCorrection } from "@/lib/certification/removal-entry-correction";
import {
  OPEN_GHG_STATEMENT_LABEL,
  RESUBMIT_REMOVAL_LABEL,
  correctionBatchEmissionsHref,
  correctionStatementHref,
  correctionStatementLabel,
  removalResubmitHref,
  returnedStatementPhrase,
  comparisonUnavailableClause,
} from "@/lib/removal-correction-copy";

const LINK_CLASS = "underline underline-offset-4 text-[var(--color-text-primary)]";
/** The quiet underlined link a Notice carries as its action. */
export const NOTICE_ACTION_LINK_CLASS = "inline-flex min-h-44 items-center body-small underline underline-offset-4";

/** "A, B and C" over parts that carry their own links. */
function JoinedParts({ parts }: { parts: { key: string; node: ReactNode }[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part.key}>
          {index > 0 && (index === parts.length - 1 ? " and " : ", ")}
          {part.node}
        </Fragment>
      ))}
    </>
  );
}

function BatchLink({ batch, facilityId }: { batch: { id: string; code: string }; facilityId: string }) {
  return <Link href={correctionBatchEmissionsHref(batch.id, facilityId)} className={LINK_CLASS}>{batch.code}</Link>;
}

/** A batch the Removal sheet returns to: the code opens the batch page, "Emissions" its Emissions tab. */
function BatchPageLink({ batch, facilityId }: { batch: { id: string; code: string }; facilityId: string }) {
  return (
    <>
      <Link href={creditBatchDeepLinkHref(batch.id, facilityId)} className={RECORD_CODE_LINK}>{batch.code}</Link>
      {" ("}<Link href={correctionBatchEmissionsHref(batch.id, facilityId)} className={LINK_CLASS}>Emissions</Link>{")"}
    </>
  );
}

/**
 * The Removal sheet's one notice for a Removal Isometric returned (variant A).
 * Once a sent fact changed it says what and asks to resubmit; before that it
 * says the statement came back and where the sent entries are corrected.
 */
export function RemovalResubmitNotice({ correction, facilityId }: { correction: RemovalCorrection; facilityId: string }) {
  const statement = (
    <Link href={correctionStatementHref(correction, facilityId)} className={LINK_CLASS}>
      {correctionStatementLabel(correction.statement)}
    </Link>
  );
  if (correction.resubmitNeeded) {
    return (
      // No title: the Status badge above already says "Resubmit needed".
      <Notice tone="warning" data-removal-correction="resubmit">
        {correction.comparison === "unavailable" ? (
          <>{comparisonUnavailableClause("this Removal")}.{correction.unavailableMessages?.[0] ? <> {correction.unavailableMessages[0]}</> : null}</>
        ) : correction.changed.length > 0 ? (
          <>
            <JoinedParts parts={correction.changed.map((change) => ({
              key: `${change.batchId}:${change.componentId}`,
              node: <>{change.componentName} (<BatchLink batch={{ id: change.batchId, code: change.batchCode }} facilityId={facilityId} />)</>,
            }))} /> changed since this Removal was sent.
          </>
        ) : (
          "Records or files changed since this Removal was sent."
        )}{" "}
        Resubmit it, then resubmit {statement}.
      </Notice>
    );
  }
  return (
    <Notice
      tone="info"
      title={RETURNED_BY_ISOMETRIC_LABEL}
      data-removal-correction="returned"
      action={<Link href={correctionStatementHref(correction, facilityId)} className={NOTICE_ACTION_LINK_CLASS}>{OPEN_GHG_STATEMENT_LABEL}</Link>}
    >
      {statement} {returnedStatementPhrase(correction.statement.status)}. Correct the records or emissions entries on{" "}
      <JoinedParts parts={correction.batches.map((batch) => ({
        key: batch.id,
        node: <BatchPageLink batch={batch} facilityId={facilityId} />,
      }))} />, then resubmit this Removal.
    </Notice>
  );
}

/**
 * Resubmit sends the Removal again through the New Removal wizard reopened on
 * it: the server returns the sent version when nothing changed and supersedes
 * it once the correction window is open and a sent fact differs. Only offered
 * once something changed.
 */
export function ResubmitRemovalAction({ correction, facilityId }: { correction: RemovalCorrection | undefined; facilityId: string }) {
  if (!correction?.resubmitNeeded) return null;
  return (
    <Link href={removalResubmitHref(correction.removalId, facilityId)} className={cn(buttonVariants({ variant: "primary" }), PHONE_TOUCH_TARGET)}>
      {RESUBMIT_REMOVAL_LABEL}
    </Link>
  );
}
