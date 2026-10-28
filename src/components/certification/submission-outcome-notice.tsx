/**
 * The one notice that says how the latest submit attempt ended and what to do.
 * The Removal sheet shows it under the status; the submit dialog shows the
 * same notice in place of the error paragraph. The fix always points at the
 * sheet footer (Review & submit, Delete Removal); the notice has no buttons.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ExplanationInfo } from "@/components/ui/explanation-info";
import { Notice } from "@/components/ui/notice";
import { INLINE_HIT_AREA } from "@/components/ui/touch-target";
import { RECORD_CODE_LINK } from "@/components/ui/record-code-link";
import { recordHref } from "@/lib/record-links";
import { cn } from "@/lib/utils";
import type { AttemptOutcome } from "@/lib/certification/submission-attempts";
import { FigurePairs } from "./submission-outcome-figures";

export type NoticeOutcome = AttemptOutcome | { kind: "interrupted" };

const LINK_CLASS = cn(RECORD_CODE_LINK, INLINE_HIT_AREA);

export function CreditBatchLink({ id, code, facilityId }: { id: string; code: string; facilityId: string }) {
  return (
    <Link href={recordHref("creditBatch", id, { facilityId })} className={LINK_CLASS}>
      {code}
    </Link>
  );
}

export function RemovalLink({ id, code, facilityId }: { id: string; code: string; facilityId: string }) {
  return (
    <Link href={recordHref("removal", id, { facilityId })} className={LINK_CLASS}>
      {code}
    </Link>
  );
}

export type OutcomeTone = "ok" | "stop" | "retry";

export function outcomeTone(outcome: NoticeOutcome): OutcomeTone {
  if (outcome.kind === "submitted") return "ok";
  if (outcome.kind === "differs") return "stop";
  return "retry";
}

/** The headline of an attempt, without the "Not submitted" lead. */
export function outcomeLine(outcome: NoticeOutcome, facilityId: string): ReactNode {
  switch (outcome.kind) {
    case "submitted":
      return "Submitted to Isometric";
    case "differs":
      return (
        <>
          <CreditBatchLink id={outcome.creditBatchId} code={outcome.creditBatchCode} facilityId={facilityId} /> no longer
          matches Isometric
        </>
      );
    case "no-answer":
      return "Isometric did not answer";
    case "interrupted":
      return "Submission interrupted";
    case "failed":
      return "Submission failed";
  }
}

function outcomeTitle(outcome: NoticeOutcome, facilityId: string): ReactNode {
  // An interrupted attempt and a lost response may have committed, so neither claims "Not submitted".
  if (outcome.kind === "interrupted" || outcome.kind === "no-answer") return outcomeLine(outcome, facilityId);
  return <>Not submitted: {outcomeLine(outcome, facilityId)}</>;
}

const CHECK_RUNS = "Check the production runs in this credit batch for later edits.";

function fixLine(outcome: NoticeOutcome, facilityId: string, finalized: boolean): ReactNode {
  switch (outcome.kind) {
    case "submitted":
      return null;
    case "differs":
      if (finalized) {
        return `${CHECK_RUNS} This Removal is finalized, so it cannot be deleted. Contact an admin or Isometric.`;
      }
      if (outcome.shared) {
        return (
          <>
            {CHECK_RUNS}{" "}
            {outcome.sharedWith ? (
              <RemovalLink id={outcome.sharedWith.id} code={outcome.sharedWith.code} facilityId={facilityId} />
            ) : (
              "Another Removal"
            )}{" "}
            also uses this credit batch, so deleting this Removal does not fix it. Contact support.
          </>
        );
      }
      return `${CHECK_RUNS} If the figures in noma are right, delete this Removal and submit again.`;
    case "no-answer":
      return "Anything already sent stays in Isometric. Review and submit again to send the rest.";
    case "interrupted":
      return "Part of it may already be in Isometric. Review and submit again to finish it. What is there is reused.";
    case "failed":
      return outcome.message
        ? `${outcome.message} Review and submit again.`
        : "Review and submit again.";
  }
}

function whyItStopped(outcome: AttemptOutcome & { kind: "differs" }, finalized: boolean): string {
  return `Isometric holds different figures for ${outcome.creditBatchCode} than noma has now, for example after a production run was edited. noma never changes Isometric by itself.${
    finalized || outcome.shared
      ? ""
      : " Deleting this Removal also removes what it created in Isometric, so the next submission sends the figures noma has now."
  }`;
}

export function SubmissionOutcomeNotice({
  outcome,
  facilityId,
  timeZone,
  finalized = false,
}: {
  outcome: NoticeOutcome;
  facilityId: string;
  timeZone: string;
  /** A finalized Removal cannot be deleted, so the fix is outside noma. */
  finalized?: boolean;
}) {
  const tone = outcomeTone(outcome);
  if (tone === "ok") return null;
  return (
    <Notice
      tone={tone === "stop" ? "error" : "warning"}
      title={outcomeTitle(outcome, facilityId)}
      data-testid="submission-outcome-notice"
    >
      {outcome.kind === "differs" && (
        <div className="mt-8">
          <FigurePairs differences={outcome.differences} timeZone={timeZone} />
        </div>
      )}
      <p className="mt-8 body-small">
        {fixLine(outcome, facilityId, finalized)}
        {outcome.kind === "differs" && <ExplanationInfo title="Why it stopped" hint={whyItStopped(outcome, finalized)} />}
      </p>
    </Notice>
  );
}
