import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import {
  RECORD_LOCK_ERROR_MESSAGE,
  RECORD_LOCK_PENDING_MESSAGE,
  RECORD_LOCK_RETRY_LABEL,
  type RecordLockLink,
  type RecordLockStatus,
  type RecordLockView,
} from "@/lib/record-lock-view";
import { recordLockLinkHref, recordLockLinkText } from "./record-lock-labels";

/** Holders named inline; the rest are counted and listed under "Used by". */
const NAMED_HOLDERS = 2;

const STORAGE_BIN_LOCKED = "Storage type and feedstock type can't be changed, because stock has already been recorded in this bin.";

function HolderLink({ link }: { link: RecordLockLink }) {
  const href = recordLockLinkHref(link);
  const text = recordLockLinkText(link);
  return href ? <Link href={href} className="underline underline-offset-4 text-[var(--color-text-primary)]">{text}</Link> : <>{text}</>;
}

/** "production run PR-1, delivery DL-2 and 3 more", each named holder a link. */
function HolderList({ holders }: { holders: readonly RecordLockLink[] }) {
  const named = holders.slice(0, NAMED_HOLDERS);
  const more = holders.length - named.length;
  const parts: ReactNode[] = named.map(link => <HolderLink key={`${link.kind}:${link.id}`} link={link} />);
  if (more > 0) parts.push(`${more} more`);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 && (index === parts.length - 1 ? " and " : ", ")}
          {part}
        </Fragment>
      ))}
    </>
  );
}

/** What Isometric said about the returned statement, in the operator's words. */
export function returnedStatementPhrase(status: string | null): string {
  return status === "FAILED_VERIFICATION" ? "failed verification" : "is back in draft";
}

/**
 * Option A of #1101 open point 2: a returned record keeps its real level and
 * says where its corrections go. One line per returned Removal.
 */
export function RecordReturnedNotice({ lock }: { lock: RecordLockView | undefined }) {
  if (!lock || lock.level === "sent" || lock.returnedBy.length === 0) return null;
  return (
    <>
      {lock.returnedBy.map((returned) => (
        <Notice key={`${returned.removal.id}:${returned.statement.id}`} tone="info" title="Returned by Isometric" data-record-lock-notice="returned">
          <HolderLink link={returned.statement} /> {returnedStatementPhrase(returned.statementStatus)}. Changes here go to{" "}
          <HolderLink link={returned.removal} /> when you resubmit it.
        </Notice>
      ))}
    </>
  );
}

/**
 * The one lock line: what holds the record, as links, and how to free it.
 * Open records have no line. Storage bins name their stock history instead
 * of a record, because no single record holds a bin. A record Isometric
 * returned gets the returned line first.
 */
export function RecordLockNotice(props: {
  lock: RecordLockView | undefined;
  /** Until the read answers, say so; a failed read offers an in-place retry. */
  status?: RecordLockStatus;
  onRetry?: () => void;
  retrying?: boolean;
  subject?: "record" | "storageBin";
  /** The kind keeps every field free while In use (a Sample), so only Sent has a line. */
  inUseLocksNothing?: boolean;
}) {
  if (!props.lock && props.status === "pending") {
    return <Notice tone="info" boxed data-record-lock-notice="pending">{RECORD_LOCK_PENDING_MESSAGE}</Notice>;
  }
  if (!props.lock && props.status === "error") {
    return (
      <Notice
        tone="error"
        data-record-lock-notice="error"
        action={props.onRetry ? <Button variant="default" size="small" busy={props.retrying} onClick={props.onRetry}>{RECORD_LOCK_RETRY_LABEL}</Button> : undefined}
      >
        {RECORD_LOCK_ERROR_MESSAGE}
      </Notice>
    );
  }
  return (
    <>
      <RecordReturnedNotice lock={props.lock} />
      <LockLine {...props} />
    </>
  );
}

function LockLine({ lock, subject = "record", inUseLocksNothing = false }: {
  lock: RecordLockView | undefined;
  subject?: "record" | "storageBin";
  inUseLocksNothing?: boolean;
}) {
  if (!lock || lock.level === "open") return null;
  if (lock.level === "inUse" && inUseLocksNothing) return null;
  if (subject === "storageBin") {
    return (
      <Notice tone="info" boxed data-record-lock-notice={lock.level}>
        {STORAGE_BIN_LOCKED}
        {lock.heldBy[0] && <> Latest: <HolderLink link={lock.heldBy[0]} />.</>}
      </Notice>
    );
  }
  if (lock.level === "sent") {
    return (
      <Notice tone="info" boxed data-record-lock-notice="sent">
        Nothing can be changed, because this was sent to Isometric with <HolderList holders={lock.heldBy} />. {lock.howToFree}
      </Notice>
    );
  }
  return (
    <Notice tone="info" boxed data-record-lock-notice="inUse">
      Some fields can{"'"}t be changed, because <HolderList holders={lock.heldBy} /> {lock.heldBy.length > 1 ? "use" : "uses"} its figures. {lock.howToFree}
    </Notice>
  );
}
