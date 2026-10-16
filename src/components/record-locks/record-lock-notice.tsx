import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Notice } from "@/components/ui/notice";
import type { RecordLockLink, RecordLockView } from "@/lib/record-lock-view";
import { recordLockLinkHref, recordLockLinkText } from "./record-lock-labels";

/** Holders named inline; the rest are counted and listed under "Used by". */
const NAMED_HOLDERS = 2;

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
  subject?: "record" | "storageBin";
  /** The kind keeps every field free while In use (a Sample), so only Sent has a line. */
  inUseLocksNothing?: boolean;
}) {
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
}) {  if (!lock || lock.level === "open") return null;
  if (lock.level === "inUse" && inUseLocksNothing) return null;
  if (subject === "storageBin") {
    return (
      <Notice tone="info" data-record-lock-notice={lock.level}>
        In use by its stock history, so the storage type and feedstock type are locked.
      </Notice>
    );
  }
  if (lock.level === "sent") {
    return (
      <Notice tone="info" data-record-lock-notice="sent">
        Sent with <HolderList holders={lock.heldBy} />, so every field is locked. {lock.howToFree}
      </Notice>
    );
  }
  const plural = lock.heldBy.length > 1;
  return (
    <Notice tone="info" data-record-lock-notice="inUse">
      In use by <HolderList holders={lock.heldBy} />, so fields that feed {plural ? "their" : "its"} numbers are locked. {lock.howToFree}
    </Notice>
  );
}
