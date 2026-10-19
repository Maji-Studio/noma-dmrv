import Link from "next/link";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { returnedStatementPhrase } from "@/components/record-locks/record-lock-notice";
import { recordLockLinkHref, recordLockLinkText } from "@/components/record-locks/record-lock-labels";
import { Notice } from "@/components/ui/notice";
import { StatusBadge } from "@/components/ui/status-badge";
import type { RecordLockView } from "@/lib/record-lock-view";

/**
 * A sent Removal whose covering GHG Statement Isometric returned (#1101 open
 * point 2, option A). Resubmission happens on that GHG Statement, so the
 * action opens it there.
 */
export const CORRECTION_NEEDED_LABEL = "Correction needed";
const OPEN_STATEMENT_LABEL = "Open GHG Statement";

function firstReturn(lock: RecordLockView | undefined) {
  return lock && lock.level !== "sent" ? lock.returnedBy[0] : undefined;
}

/** "GHG Statement Jul 1 to Sep 30, 2026 failed verification. Correct this Removal's records, then resubmit." */
function correctionSentence(returned: NonNullable<ReturnType<typeof firstReturn>>, where = ""): string {
  return `${recordLockLinkText(returned.statement)} ${returnedStatementPhrase(returned.statementStatus)}. Correct this Removal's records, then resubmit${where}.`;
}

/** Removals list: badge, one reason line and the way to resubmit, under the status badge. */
export function RemovalCorrectionCell({ lock }: { lock: RecordLockView | undefined }) {
  const returned = firstReturn(lock);
  if (!returned) return null;
  const href = recordLockLinkHref(returned.statement);
  return (
    <span className="flex flex-col items-start gap-4" data-removal-correction>
      <StatusBadge status="pending" label={CORRECTION_NEEDED_LABEL} />
      <span className="relative inline-flex items-start gap-6 body-caption text-[var(--color-text-secondary)]">
        <WarningIcon size={14} weight="fill" aria-hidden className="mt-px shrink-0 text-[var(--color-signal-orange)]" />
        <span className="line-clamp-2">{correctionSentence(returned)}</span>
      </span>
      {href && (
        // Paints above the badge's expanded hit area, and never opens the row.
        <Link href={href} onClick={(event) => event.stopPropagation()}
          className="relative inline-flex min-h-44 items-center body-caption underline underline-offset-4">
          {OPEN_STATEMENT_LABEL}
        </Link>
      )}
    </span>
  );
}

/** Removal sheet: the same state as a Notice with the action. */
export function RemovalCorrectionNotice({ lock }: { lock: RecordLockView | undefined }) {
  const returned = firstReturn(lock);
  if (!returned) return null;
  const href = recordLockLinkHref(returned.statement);
  return (
    <Notice
      tone="warning"
      title={CORRECTION_NEEDED_LABEL}
      data-removal-correction
      action={href ? <Link href={href} className="inline-flex min-h-44 items-center body-small underline underline-offset-4">{OPEN_STATEMENT_LABEL}</Link> : undefined}
    >
      {correctionSentence(returned, " from the GHG Statement")}
    </Notice>
  );
}
